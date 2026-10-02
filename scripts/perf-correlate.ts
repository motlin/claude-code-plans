/**
 * Correlation check (measurement plan §5): does each lab count track real latency? Runs the server lab journeys and
 * the shaped hot paths across the small → typical → large-long → large-wide fixture sweep, each shape in its own child
 * process with a temp HOME and DB (never the :7526 server), and times every journey with `performance.now()`, keeping
 * the median of 15 runs. It then computes Spearman ρ between each lab count and its journey's wall time and writes
 * .llm/perf/correlation.md. A count whose ρ stays below 0.9 loses its ceiling (DIAGNOSTIC_FAMILIES in
 * tests/perf/ratchet.ts).
 *
 *   just perf-correlate [--runs 15] [--shapes small,typical] [--json sweep.json] [--from sweep.json]
 *                       [--baseline before.json] [--notes notes.md] [--out .llm/perf/correlation.md]
 *
 * `--json` keeps the raw sweep; `--from` renders an earlier one instead of measuring; `--baseline` adds a before/after
 * table against an earlier sweep, for the negative control (§5.3) and per-commit deltas (§5.2); `--notes` appends a
 * hand-written findings section.
 */

import {execFile, execFileSync} from "node:child_process";
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {loadavg, tmpdir} from "node:os";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {z} from "zod";
import {DIAGNOSTIC_FAMILIES, diagnosticFamily, loadCeilings, type Ceilings} from "../tests/perf/ratchet";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(REPOSITORY_ROOT, ".llm", "perf", "correlation.md");
const DEFAULT_RUNS = 15;
const SHAPES = ["small", "typical", "large-long", "large-wide"] as const;
type ShapeName = (typeof SHAPES)[number];
const KEEP_RHO = 0.9;
/** A count that moves less than this across the sweep cannot be judged by a size sweep. */
const MIN_SPREAD = 0.1;

// --- statistics --------------------------------------------------------------------------------------------------

export function median(values: readonly number[]): number {
	if (values.length === 0) throw new Error("median of an empty list");
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** 1-based ranks, ties sharing their average rank. */
function ranks(values: readonly number[]): number[] {
	const order = values.map((value, index) => ({value, index})).sort((a, b) => a.value - b.value);
	const result = Array.from({length: values.length}, () => 0);
	for (let start = 0; start < order.length;) {
		let end = start;
		while (end + 1 < order.length && order[end + 1]!.value === order[start]!.value) end++;
		const rank = (start + end) / 2 + 1;
		for (let position = start; position <= end; position++) result[order[position]!.index] = rank;
		start = end + 1;
	}
	return result;
}

function mean(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pearson(x: readonly number[], y: readonly number[]): number | undefined {
	const meanX = mean(x);
	const meanY = mean(y);
	let covariance = 0;
	let varianceX = 0;
	let varianceY = 0;
	for (let index = 0; index < x.length; index++) {
		const dx = x[index]! - meanX;
		const dy = y[index]! - meanY;
		covariance += dx * dy;
		varianceX += dx * dx;
		varianceY += dy * dy;
	}
	if (varianceX === 0 || varianceY === 0) return undefined;
	return covariance / Math.sqrt(varianceX * varianceY);
}

/** Spearman rank correlation, or undefined when either list is constant or shorter than two. */
export function spearman(x: readonly number[], y: readonly number[]): number | undefined {
	if (x.length !== y.length) throw new Error(`spearman needs equal-length lists, got ${x.length} and ${y.length}`);
	if (x.length < 2) return undefined;
	return pearson(ranks(x), ranks(y));
}

/** Least-squares slope of y on x, or undefined when x is constant. */
export function slope(x: readonly number[], y: readonly number[]): number | undefined {
	const meanX = mean(x);
	const meanY = mean(y);
	let covariance = 0;
	let varianceX = 0;
	for (let index = 0; index < x.length; index++) {
		covariance += (x[index]! - meanX) * (y[index]! - meanY);
		varianceX += (x[index]! - meanX) ** 2;
	}
	return varianceX === 0 ? undefined : covariance / varianceX;
}

export type Verdict = "keep" | "demote" | "untested";

export function verdict(counts: readonly number[], rho: number | undefined): Verdict {
	const largest = Math.max(...counts.map(Math.abs));
	const spread = Math.max(...counts) - Math.min(...counts);
	if (largest === 0 || spread / largest < MIN_SPREAD) return "untested";
	return rho !== undefined && rho >= KEEP_RHO ? "keep" : "demote";
}

// --- sweep ---------------------------------------------------------------------------------------------------------

const JourneySampleSchema = z
	.object({
		journey: z.string().min(1),
		counts: z.record(z.string().min(1), z.number()),
		wallMs: z.array(z.number().nonnegative()).min(1),
	})
	.strict();
type JourneySample = z.infer<typeof JourneySampleSchema>;

const ShapeSweepSchema = z
	.object({
		shape: z.enum(SHAPES),
		fileBytes: z.number().int().nonnegative(),
		loadBefore: z.array(z.number()),
		loadAfter: z.array(z.number()),
		journeys: z.array(JourneySampleSchema),
	})
	.strict();
type ShapeSweep = z.infer<typeof ShapeSweepSchema>;

const SweepSchema = z
	.object({
		sha: z.string().min(1),
		node: z.string().min(1),
		measuredAt: z.string().min(1),
		runs: z.number().int().positive(),
		shapes: z.array(ShapeSweepSchema).min(1),
	})
	.strict();
export type Sweep = z.infer<typeof SweepSchema>;

export function parseSweep(json: string): Sweep {
	return SweepSchema.parse(JSON.parse(json));
}

export interface Correlation {
	family: string;
	journey: string;
	counts: number[];
	wallMs: number[];
	rho: number | undefined;
	slope: number | undefined;
	verdict: Verdict;
}

function family(id: string, shape: string): string {
	return id.replace(`.${shape}.`, ".<shape>.");
}

/** One row per count family, sorted by family: its count and its journey's median wall time in sweep shape order. */
export function correlate(sweep: Sweep): Correlation[] {
	const rows = new Map<string, Correlation>();
	for (const {shape, journeys} of sweep.shapes) {
		for (const {journey, counts, wallMs} of journeys) {
			for (const [id, count] of Object.entries(counts)) {
				const key = family(id, shape);
				const row = rows.get(key) ?? {
					family: key,
					journey: family(journey, shape),
					counts: [],
					wallMs: [],
					rho: undefined,
					slope: undefined,
					verdict: "untested",
				};
				row.counts.push(count);
				row.wallMs.push(median(wallMs));
				rows.set(key, row);
			}
		}
	}
	return [...rows.values()]
		.map((row) => {
			const rho = spearman(row.counts, row.wallMs);
			return {...row, rho, slope: slope(row.counts, row.wallMs), verdict: verdict(row.counts, rho)};
		})
		.sort((a, b) => (a.family < b.family ? -1 : a.family > b.family ? 1 : 0));
}

// --- report --------------------------------------------------------------------------------------------------------

function formatNumber(value: number | undefined, digits: number): string {
	return value === undefined ? "n/a" : value.toFixed(digits);
}

function formatSlope(row: Correlation): string {
	if (row.slope === undefined) return "n/a";
	if (/(bytes|Bytes|bytesRead)$/.test(row.family)) return `${(row.slope * 1e6).toFixed(3)} ms/MB`;
	if (row.family.endsWith(".calls")) return `${(row.slope * 1e6).toFixed(3)} ms/10⁶ calls`;
	return `${row.slope.toPrecision(3)} ms/unit`;
}

function ceilingStatus(row: Correlation, shapes: readonly string[], ceilings: Ceilings): string {
	if (diagnosticFamily(row.family.replace("<shape>", "typical"), DIAGNOSTIC_FAMILIES) !== undefined) {
		return "diagnostic";
	}
	const ids = shapes.map((shape) => row.family.replace("<shape>", shape));
	return ids.some((id) => ceilings[id] !== undefined) ? "ceiling" : "none";
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
	return [
		`| ${header.join(" | ")} |`,
		`|${header.map(() => "---").join("|")}|`,
		...rows.map((row) => `| ${row.join(" | ")} |`),
	].join("\n");
}

function formatLoad(load: readonly number[]): string {
	return load.map((value) => value.toFixed(2)).join(" ");
}

function journeyWalls(sweep: Sweep): Map<string, number[]> {
	const walls = new Map<string, number[]>();
	for (const {shape, journeys} of sweep.shapes) {
		for (const {journey, wallMs} of journeys) {
			const key = family(journey, shape);
			walls.set(key, [...(walls.get(key) ?? []), median(wallMs)]);
		}
	}
	return new Map([...walls].sort(([a], [b]) => (a < b ? -1 : 1)));
}

function negativeControl(before: Sweep, after: Sweep): string {
	const previous = new Map(correlate(before).map((row) => [row.family, row]));
	const moved = correlate(after).filter((row) => {
		const old = previous.get(row.family);
		return old !== undefined && old.counts.some((count, index) => count !== row.counts[index]);
	});
	const shapes = after.shapes.map(({shape}) => shape);
	if (moved.length === 0) return "No lab count moved between the two sweeps.";
	return table(
		["count", ...shapes.map((shape) => `${shape} count`), ...shapes.map((shape) => `${shape} wall ms`)],
		moved.map((row) => {
			const old = previous.get(row.family)!;
			return [
				`\`${row.family}\``,
				...row.counts.map((count, index) => `${old.counts[index]} → ${count}`),
				...row.wallMs.map((wall, index) => `${formatNumber(old.wallMs[index], 3)} → ${formatNumber(wall, 3)}`),
			];
		}),
	);
}

function formatReport(
	sweep: Sweep,
	options: {ceilings: Ceilings; baseline?: {sweep: Sweep; label: string}; notes?: string},
): string {
	const shapes = sweep.shapes.map(({shape}) => shape);
	const rows = correlate(sweep);
	const mismatches = rows.flatMap((row) => {
		const status = ceilingStatus(row, shapes, options.ceilings);
		if (row.verdict === "demote" && status === "ceiling") {
			return [`- \`${row.family}\` has ρ ${formatNumber(row.rho, 2)} but still has ceilings.`];
		}
		if (row.verdict === "keep" && status === "diagnostic") {
			return [`- \`${row.family}\` is a diagnostic but has ρ ${formatNumber(row.rho, 2)} in this sweep.`];
		}
		return [];
	});
	const sections = [
		"# Lab counts vs wall time (measurement plan §5)",
		`Measured ${sweep.measuredAt} on ${sweep.sha}, node ${sweep.node}, median of ${sweep.runs} runs per journey. ` +
			"Each shape ran in its own child process with a temp HOME and DB. Generated by `scripts/perf-correlate.ts` " +
			"(`just perf-correlate`).",
		"## Machine load per shape",
		table(
			["shape", "fixture bytes", "load avg before (1/5/15 min)", "load avg after"],
			sweep.shapes.map(({shape, fileBytes, loadBefore, loadAfter}) => [
				shape,
				String(fileBytes),
				formatLoad(loadBefore),
				formatLoad(loadAfter),
			]),
		),
		"## Wall time per journey (median ms)",
		table(
			["journey", ...shapes],
			[...journeyWalls(sweep)].map(([journey, walls]) => [
				`\`${journey}\``,
				...walls.map((wall) => formatNumber(wall, 3)),
			]),
		),
		`## Spearman ρ per count (keep at ρ ≥ ${KEEP_RHO})`,
		`\`untested\` means the count moves less than ${MIN_SPREAD * 100}% across the shapes, so a size sweep cannot say ` +
			"whether it tracks latency; it keeps its ceiling until a targeted before/after (§5.2) judges it. `diagnostic` " +
			"means it is in DIAGNOSTIC_FAMILIES (tests/perf/ratchet.ts): still measured, no ceiling.",
		table(
			["count", ...shapes, "ρ", "slope", "verdict", "ceilings"],
			rows.map((row) => [
				`\`${row.family}\``,
				...row.counts.map(String),
				formatNumber(row.rho, 2),
				formatSlope(row),
				row.verdict,
				ceilingStatus(row, shapes, options.ceilings),
			]),
		),
		"## Demoted counts",
		Object.entries(DIAGNOSTIC_FAMILIES)
			.map(([name, {reason}]) => `- \`${name}\`: ${reason}.`)
			.join("\n"),
		"## Verdicts that disagree with the ceilings",
		mismatches.length === 0 ? "None." : mismatches.join("\n"),
	];
	if (options.baseline !== undefined) {
		sections.push(
			`## Before/after against ${options.baseline.label}`,
			`Before: ${options.baseline.sweep.sha} measured ${options.baseline.sweep.measuredAt}. ` +
				"Only counts that changed are listed.",
			negativeControl(options.baseline.sweep, sweep),
		);
	}
	if (options.notes !== undefined) sections.push(options.notes.trim());
	return `${sections.join("\n\n")}\n`;
}

// --- measurement (child) -------------------------------------------------------------------------------------------

const PROJECT = "-repo";

function git(cwd: string, ...args: string[]): void {
	execFileSync(
		"git",
		[
			"-c",
			"user.name=perf",
			"-c",
			"user.email=perf@example.com",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			...args,
		],
		{cwd, stdio: "ignore"},
	);
}

function appendedLines(sessionId: string, count: number, batch: number): string {
	let text = "";
	for (let index = 0; index < count; index++) {
		const turn = `${batch}-${index}`;
		text += `${JSON.stringify({
			type: "user",
			sessionId,
			uuid: `correlate-append-${turn}`,
			parentUuid: null,
			timestamp: "2000-01-01T00:00:00.000Z",
			message: {role: "user", content: `Live append ${turn}: keep going with the next step.`},
		})}\n`;
	}
	return text;
}

function medianCounts(samples: readonly Record<string, number>[]): Record<string, number> {
	return Object.fromEntries(Object.keys(samples[0]!).map((id) => [id, median(samples.map((sample) => sample[id]!))]));
}

type ApiHandler = (context: {params: {id: string}; request: Request}) => Response | Promise<Response>;

const SESSION_OPEN_ROUTES = {
	detail: {module: "../src/routes/api/sessions.$id", path: ""},
	transcript: {module: "../src/routes/api/sessions.$id.transcript", path: "/transcript"},
	subagents: {module: "../src/routes/api/sessions.$id.subagents", path: "/subagents"},
} as const;

/**
 * `cold-append` times the one-line live append exactly as the ratcheted lab run hits it: the first append after the
 * session was indexed, which re-parses the transcript. That state exists once per process, so the parent spawns one
 * child per timed run. `main` times everything else.
 */
const CHILD_MODES = ["main", "cold-append"] as const;
type ChildMode = (typeof CHILD_MODES)[number];

/** Runs in a child whose HOME and XDG_CACHE_HOME point under `root`, so getDb() opens a fresh temp DB. */
async function measureShape(
	shapeName: ShapeName,
	root: string,
	runs: number,
	mode: ChildMode,
): Promise<JourneySample[]> {
	const home = process.env["HOME"] ?? "";
	const cache = process.env["XDG_CACHE_HOME"] ?? "";
	if (!home.startsWith(root) || !cache.startsWith(root)) {
		throw new Error(`refusing to measure outside ${root}: HOME=${home} XDG_CACHE_HOME=${cache}`);
	}
	const {generateTranscript, PERF_SHAPES, seedFixtureDb} = await import("../tests/perf/fixtures/generate-transcript");
	const {getDb} = await import("../src/lib/db");
	const schema = await import("../src/lib/db/schema");
	const {eq} = await import("drizzle-orm");
	const serverScope = await import("../src/lib/perf/server-scope");
	const watcher = await import("../src/lib/watcher");
	const {prepareHotPath} = await import("../tests/perf/hot-path-scenarios");
	const ids = await import("../tests/perf/perf-ids");

	const projectsDir = join(home, ".claude", "projects");
	mkdirSync(join(projectsDir, PROJECT), {recursive: true});
	const repo = join(root, "repo");
	mkdirSync(repo);
	git(repo, "init", "--quiet");
	git(repo, "commit", "--quiet", "--allow-empty", "--message", "fixture");

	const cached = await generateTranscript(PERF_SHAPES[shapeName]);
	const file = join(projectsDir, PROJECT, basename(cached));
	copyFileSync(cached, file);
	const sessionId = basename(file, ".jsonl");
	const db = getDb();
	await seedFixtureDb(db, [file]);
	db.index.update(schema.projects).set({projectPath: repo}).where(eq(schema.projects.id, PROJECT)).run();

	const samples: JourneySample[] = [];

	for (const [endpoint, {module, path}] of mode === "main" ? Object.entries(SESSION_OPEN_ROUTES) : []) {
		const {Route} = (await import(module)) as {
			Route: {options: {server: {handlers: Record<string, ApiHandler>}}};
		};
		const handler = Route.options.server.handlers["GET"]!;
		const prefix = ids.sessionOpenPrefix(shapeName, endpoint as keyof typeof SESSION_OPEN_ROUTES);
		const counts: Record<string, number>[] = [];
		const wallMs: number[] = [];
		for (let run = 0; run <= runs; run++) {
			await serverScope.withPerfScope(`correlate-${endpoint}`, async () => {
				const started = performance.now();
				const response = await handler({
					params: {id: sessionId},
					request: new Request(`http://localhost/api/sessions/${sessionId}${path}`),
				});
				const body = await response.text();
				const elapsed = performance.now() - started;
				const counters = serverScope.currentPerfCounters()!;
				// Run 0 warms the module graph and the OS page cache; it is not timed.
				if (run === 0) return;
				wallMs.push(elapsed);
				counts.push(
					ids.metricIds(prefix, {
						"sql.count": counters.sql.count,
						"jsonl.bytesRead": counters.jsonl.bytesRead,
						"jsonl.fullScans": counters.jsonl.fullScans,
						"proc.spawned": counters.proc.spawned,
						"resp.bytes": Buffer.byteLength(body.replaceAll(root, "")),
					}),
				);
			});
		}
		samples.push({journey: prefix, counts: medianCounts(counts), wallMs});
	}

	// Same state as tests/perf/server-live-append.perf.test.ts: the watcher has caught up with the file and snapshotted
	// the session, then `count` lines land and one fire picks them up. In `main`, the untimed run 0 is the cold one-line
	// append, so the 20-line runs that follow see the same warm caches as the ratcheted run.
	const offsets = new Map<string, number>();
	const fire = (): Promise<{elapsed: number; bytesRead: number; fullScans: number; sql: number; payload: number}> =>
		serverScope.withPerfScope("correlate-live-append", async () => {
			let payload = 0;
			const started = performance.now();
			await watcher.processJsonlAppend(
				db.index,
				file,
				offsets,
				(type, data) => {
					payload += Buffer.byteLength(
						`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`.replaceAll(root, ""),
					);
				},
				{projectsDir, plansDir: ""},
			);
			const elapsed = performance.now() - started;
			const counters = serverScope.currentPerfCounters()!;
			return {
				elapsed,
				bytesRead: counters.jsonl.bytesRead,
				fullScans: counters.jsonl.fullScans,
				sql: counters.sql.count,
				payload,
			};
		});
	let batch = 0;
	const [coldCount, warmCount] = ids.LIVE_APPEND_SIZES;
	const appendRuns =
		mode === "main" ? {count: warmCount, first: 1, last: runs} : {count: coldCount, first: 0, last: 0};
	{
		const {count} = appendRuns;
		const prefix = ids.liveAppendPrefix(shapeName, count);
		const counts: Record<string, number>[] = [];
		const wallMs: number[] = [];
		for (let run = 0; run <= appendRuns.last; run++) {
			offsets.set(file, statSync(file).size);
			await fire();
			const text = appendedLines(sessionId, count, batch++);
			writeFileSync(file, text, {flag: "a"});
			const measured = await fire();
			if (run < appendRuns.first) continue;
			wallMs.push(measured.elapsed);
			counts.push(
				ids.metricIds(prefix, {
					readAmplification: Math.round(measured.bytesRead / Buffer.byteLength(text)),
					"jsonl.fullScans": measured.fullScans,
					"sql.count": measured.sql,
					"sse.payloadBytes": measured.payload,
				}),
			);
		}
		samples.push({journey: prefix, counts: medianCounts(counts), wallMs});
	}

	for (const fn of mode === "main" ? ids.HOT_PATH_SHAPED_FNS : []) {
		const run = await prepareHotPath(fn, shapeName);
		run();
		const wallMs: number[] = [];
		for (let index = 0; index < runs; index++) {
			const started = performance.now();
			run();
			wallMs.push(performance.now() - started);
		}
		// The call count comes from the V8 harness in the parent; it cannot run inside this instrumented process.
		samples.push({journey: ids.hotPathId(fn, shapeName), counts: {}, wallMs});
	}
	db.close();
	return samples;
}

// --- orchestration (parent) ----------------------------------------------------------------------------------------

const execFileAsync = promisify(execFile);

function lastJsonLine(stdout: string): unknown {
	const lines = stdout.trim().split("\n");
	return JSON.parse(lines[lines.length - 1]!);
}

async function hotPathCalls(fn: string, shape: ShapeName): Promise<number> {
	const {HOT_PATH_NODE_FLAGS} = await import("../tests/perf/perf-ids");
	const harness = join(REPOSITORY_ROOT, "tests", "perf", "run-hot-path.mjs");
	const {stdout} = await execFileAsync(process.execPath, [...HOT_PATH_NODE_FLAGS, harness, fn, shape], {
		cwd: REPOSITORY_ROOT,
		maxBuffer: 64 * 1024 * 1024,
	});
	return (lastJsonLine(stdout) as {calls: number}).calls;
}

async function sweepShape(shape: ShapeName, runs: number): Promise<ShapeSweep> {
	const {generateTranscript, PERF_SHAPES} = await import("../tests/perf/fixtures/generate-transcript");
	const fileBytes = statSync(await generateTranscript(PERF_SHAPES[shape])).size;
	const loadBefore = loadavg();
	const journeys = await runChild(shape, runs, "main");
	const cold: JourneySample[] = [];
	for (let run = 0; run < runs; run++) cold.push(...(await runChild(shape, 1, "cold-append")));
	journeys.push({
		journey: cold[0]!.journey,
		counts: medianCounts(cold.map(({counts}) => counts)),
		wallMs: cold.flatMap(({wallMs}) => wallMs),
	});
	for (const sample of journeys) {
		const match = /^hot\.([^.]+)\./.exec(sample.journey);
		if (match) sample.counts = {[sample.journey]: await hotPathCalls(match[1]!, shape)};
	}
	return {shape, fileBytes, loadBefore, loadAfter: loadavg(), journeys};
}

async function runChild(shape: ShapeName, runs: number, mode: ChildMode): Promise<JourneySample[]> {
	const root = mkdtempSync(join(tmpdir(), "perf-correlate-"));
	try {
		const {stdout} = await execFileAsync(
			process.execPath,
			["--import", "tsx", fileURLToPath(import.meta.url), "--child", shape, root, String(runs), mode],
			{
				cwd: REPOSITORY_ROOT,
				maxBuffer: 64 * 1024 * 1024,
				env: {
					...process.env,
					HOME: join(root, "home"),
					XDG_CACHE_HOME: join(root, "cache"),
					XDG_CONFIG_HOME: join(root, "config"),
				},
			},
		);
		return z.array(JourneySampleSchema).parse(lastJsonLine(stdout));
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
}

function option(argv: readonly string[], name: string): string | undefined {
	const index = argv.indexOf(name);
	if (index === -1) return undefined;
	const value = argv[index + 1];
	if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
	return value;
}

async function main(argv: readonly string[]): Promise<void> {
	if (argv[0] === "--child") {
		const [, shape, root, runs, mode] = argv;
		const samples = await measureShape(
			z.enum(SHAPES).parse(shape),
			root!,
			Number(runs),
			z.enum(CHILD_MODES).parse(mode),
		);
		process.stdout.write(`\n${JSON.stringify(samples)}\n`);
		process.exit(0);
	}
	const runs = Number(option(argv, "--runs") ?? DEFAULT_RUNS);
	if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs needs a positive integer");
	const shapes = z.array(z.enum(SHAPES)).parse(option(argv, "--shapes")?.split(",") ?? [...SHAPES]);
	const from = option(argv, "--from");
	const baselinePath = option(argv, "--baseline");
	const notesPath = option(argv, "--notes");
	const jsonPath = option(argv, "--json");
	const out = resolve(option(argv, "--out") ?? DEFAULT_OUT);

	let sweep: Sweep;
	if (from !== undefined) {
		sweep = parseSweep(readFileSync(from, "utf8"));
	} else {
		const measured: ShapeSweep[] = [];
		for (const shape of shapes) {
			console.error(`measuring ${shape} (${runs} runs)…`);
			measured.push(await sweepShape(shape, runs));
		}
		sweep = {
			sha: execFileSync("git", ["rev-parse", "--short", "HEAD"], {cwd: REPOSITORY_ROOT, encoding: "utf8"}).trim(),
			node: process.version,
			measuredAt: new Date().toISOString(),
			runs,
			shapes: measured,
		};
	}
	if (jsonPath !== undefined) writeFileSync(jsonPath, `${JSON.stringify(sweep, null, "\t")}\n`);

	const report = formatReport(sweep, {
		ceilings: loadCeilings(),
		...(baselinePath === undefined
			? {}
			: {baseline: {sweep: parseSweep(readFileSync(baselinePath, "utf8")), label: basename(baselinePath)}}),
		...(notesPath === undefined ? {} : {notes: readFileSync(notesPath, "utf8")}),
	});
	mkdirSync(dirname(out), {recursive: true});
	writeFileSync(out, report);
	console.error(`wrote ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main(process.argv.slice(2));
}
