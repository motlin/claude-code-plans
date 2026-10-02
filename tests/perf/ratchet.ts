import {execFileSync} from "node:child_process";
import {mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {threadId} from "node:worker_threads";
import {z} from "zod";

/**
 * Perf ratchet (measurement plan §4.4). Every measured count must equal its checked-in ceiling within the entry's
 * tolerance: a rise is a regression, and a drop must be locked in by lowering the ceiling in the same commit. There is
 * no automatic write mode; `results.json` only records what was measured.
 *
 * results.json and diagnostics.json live in node_modules/.cache, which every commit git-test checks out shares. Each
 * file is stamped with the git tree it was measured on, and a file from another tree, or from before the stamp, is read
 * as empty and overwritten rather than parsed with this tree's strict schema.
 */

const CeilingEntrySchema = z
	.object({
		ceiling: z.number().nonnegative(),
		unit: z.string().min(1),
		tolerance: z.number().nonnegative(),
		reason: z.string().min(1).optional(),
		raisedAt: z.string().min(1).optional(),
	})
	.strict();

const CeilingsSchema = z.record(z.string().min(1), CeilingEntrySchema);

export type Ceilings = z.infer<typeof CeilingsSchema>;

const ResultEntrySchema = z
	.object({
		value: z.number(),
		unit: z.string().min(1).optional(),
	})
	.strict();

const ResultsSchema = z.record(z.string().min(1), ResultEntrySchema);

export type Results = z.infer<typeof ResultsSchema>;

const ResultsFileSchema = z
	.object({
		tree: z.string().min(1),
		results: ResultsSchema,
	})
	.strict();

const HERE = dirname(fileURLToPath(import.meta.url));
export const CEILINGS_PATH = join(HERE, "ceilings.json");
export const DEFAULT_RESULTS_PATH = join(HERE, "..", "..", "node_modules", ".cache", "ccb-perf", "results.json");

export function loadCeilings(json: string = readFileSync(CEILINGS_PATH, "utf8")): Ceilings {
	const ceilings = CeilingsSchema.parse(JSON.parse(json));
	const keys = Object.keys(ceilings);
	if (keys.some((key, index) => index > 0 && keys[index - 1]! > key)) {
		throw new Error("tests/perf/ceilings.json keys must be sorted");
	}
	return ceilings;
}

/** The git tree of HEAD, which stamps the results files; "unknown" outside a git checkout. */
export function currentTree(): string {
	try {
		return execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
			cwd: HERE,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return "unknown";
	}
}

function isStampedWith(file: unknown, tree: string): boolean {
	return typeof file === "object" && file !== null && !Array.isArray(file) && "tree" in file && file.tree === tree;
}

/** The results recorded on `tree`; a missing file, or one written on another tree or in an older format, reads as empty. */
export function readResults(resultsPath: string, tree: string): Results {
	let json: string;
	try {
		json = readFileSync(resultsPath, "utf8");
	} catch {
		return {};
	}
	let file: unknown;
	try {
		file = JSON.parse(json);
	} catch {
		return {};
	}
	return isStampedWith(file, tree) ? ResultsFileSchema.parse(file).results : {};
}

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 5;
const sleepCell = new Int32Array(new SharedArrayBuffer(4));

function isErrorCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Parallel vitest workers all record into one results file, so the read-merge-write runs under a cross-process lock
 * (an exclusive `mkdir`), and the write goes through a temp file and rename so no reader ever sees a partial file.
 */
function withResultsLock(resultsPath: string, action: () => void): void {
	const lockPath = `${resultsPath}.lock`;
	for (;;) {
		try {
			mkdirSync(lockPath);
			break;
		} catch (error) {
			if (!isErrorCode(error, "EEXIST")) {
				throw error;
			}
		}
		try {
			if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
				rmSync(lockPath, {recursive: true, force: true});
				continue;
			}
		} catch (error) {
			if (!isErrorCode(error, "ENOENT")) {
				throw error;
			}
			continue;
		}
		Atomics.wait(sleepCell, 0, 0, LOCK_RETRY_MS);
	}
	try {
		action();
	} finally {
		rmSync(lockPath, {recursive: true, force: true});
	}
}

function recordResult(resultsPath: string, tree: string, id: string, value: number, unit: string | undefined): void {
	mkdirSync(dirname(resultsPath), {recursive: true});
	withResultsLock(resultsPath, () => {
		const results = readResults(resultsPath, tree);
		results[id] = unit === undefined ? {value} : {value, unit};
		const sorted = Object.fromEntries(Object.entries(results).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
		const tempPath = `${resultsPath}.${process.pid}.${threadId}.tmp`;
		writeFileSync(tempPath, `${JSON.stringify({tree, results: sorted}, null, "\t")}\n`);
		renameSync(tempPath, resultsPath);
	});
}

export interface DiagnosticFamily {
	unit: string;
	/** Why the count lost its ceiling: its Spearman ρ against wall time in the §5 size sweep. */
	reason: string;
}

/**
 * Counts demoted by the correlation check (measurement plan §5.5, `just perf-correlate`, report in
 * .llm/perf/correlation.md). Each keeps being measured but has no ceiling: its Spearman ρ against the journey's wall
 * time across the small → large-wide sweep stayed below 0.9, so lowering it would not make anything faster. `<shape>`
 * stands for one fixture shape. They are recorded to diagnostics.json next to results.json, never into results.json, so
 * `just perf-ceilings` and older strict readers of results.json never see them.
 */
export const DIAGNOSTIC_FAMILIES: Record<string, DiagnosticFamily> = {
	"hot.mergeTranscriptData.<shape>.calls": {
		unit: "calls",
		reason: "ρ 1.0/1.0/0.8 at load 4, 0.4–0.8 under load: 15–50 µs per run, typical and large-long tie on calls",
	},
	"hot.readStructuredTranscript.<shape>.calls": {
		unit: "calls",
		reason: "ρ 0.8 in every sweep: calls follow lines, wall time follows bytes (large-wide: fewer calls, most time)",
	},
	"server.liveAppend.<shape>.1.sql.count": {
		unit: "count",
		reason: "ρ 0.8: the one-line append's time is the transcript re-parse, not its 25–54 queries",
	},
	"server.liveAppend.<shape>.1.sse.payloadBytes": {
		unit: "bytes",
		reason: "ρ 0.8: about 700 bytes of SSE payload, flat while wall time grows 36x",
	},
	"server.sessionOpen.<shape>.detail.resp.bytes": {
		unit: "bytes",
		reason: "ρ 0.8 (0.6–1.0 under load): about 500 bytes of JSON, flat while wall time follows the transcript read",
	},
};

/** The DIAGNOSTIC_FAMILIES key that matches `id`, where `<shape>` matches exactly one dotted segment. */
export function diagnosticFamily(id: string, families: Record<string, DiagnosticFamily>): string | undefined {
	const segments = id.split(".");
	return Object.keys(families).find((family) => {
		const pattern = family.split(".");
		return (
			pattern.length === segments.length &&
			pattern.every((part, index) => part === "<shape>" || part === segments[index])
		);
	});
}

export function createRatchet(options: {
	ceilings: Ceilings;
	resultsPath: string;
	/** The git tree being measured; results files stamped with any other tree are discarded. */
	tree: string;
	diagnostics?: Record<string, DiagnosticFamily>;
}): (id: string, value: number) => void {
	const {ceilings, resultsPath, tree, diagnostics = {}} = options;
	const diagnosticsPath = join(dirname(resultsPath), "diagnostics.json");
	return (id, value) => {
		const entry = ceilings[id];
		const family = diagnosticFamily(id, diagnostics);
		if (family !== undefined) {
			const {unit, reason} = diagnostics[family]!;
			recordResult(diagnosticsPath, tree, id, value, unit);
			if (entry !== undefined) {
				throw new Error(`${id} is a diagnostic (${reason}); remove its ceiling from tests/perf/ceilings.json`);
			}
			return;
		}
		recordResult(resultsPath, tree, id, value, entry?.unit);
		if (entry === undefined) {
			throw new Error(`${id} has no ceiling; add it to tests/perf/ceilings.json`);
		}
		const {ceiling, tolerance} = entry;
		if (value > ceiling * (1 + tolerance)) {
			throw new Error(
				`${id} rose from ${ceiling} to ${value}; fix the regression or raise the ceiling with a reason`,
			);
		}
		if (value < ceiling * (1 - tolerance)) {
			throw new Error(
				`${id} improved from ${ceiling} to ${value}; lower the ceiling in tests/perf/ceilings.json in this same commit`,
			);
		}
	};
}

let defaultRatchet: ((id: string, value: number) => void) | undefined;

export function ratchet(id: string, value: number): void {
	defaultRatchet ??= createRatchet({
		ceilings: loadCeilings(),
		resultsPath: DEFAULT_RESULTS_PATH,
		tree: currentTree(),
		diagnostics: DIAGNOSTIC_FAMILIES,
	});
	defaultRatchet(id, value);
}
