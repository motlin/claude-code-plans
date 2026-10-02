/**
 * Browser-lab stability gate (measurement plan §4.6, §7 decision 4). Runs the scripts/perf-lab.ts journeys 10 times on
 * one fresh fixture server and classifies every journey × metric: stable when all runs are identical, or when
 * (max − min) / median ≤ 2%. Writes `.llm/perf/browser-lab-stability.md`; only metrics it lists as stable may get
 * ceilings, at the tolerance it gives.
 *
 * Usage: vp exec tsx scripts/perf-lab-stability.ts [--runs 10] [--port 7538] [--journey J1 ...]
 *                                                  [--out .llm/perf/browser-lab-stability.md]
 */

import {mkdirSync, writeFileSync} from "node:fs";
import {loadavg} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
	gitSha,
	JOURNEY_TITLES,
	JOURNEYS,
	METRIC_KEYS,
	parseLabArgs,
	runLab,
	summarize,
	type JourneyId,
	type LabRun,
} from "./perf-lab";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(REPOSITORY_ROOT, ".llm", "perf", "browser-lab-stability.md");
const DEFAULT_RUNS = 10;

/** The widest (max − min) / median a metric may show across runs and still be ratcheted. */
export const STABILITY_LIMIT = 0.02;

export interface StabilityVerdict {
	min: number;
	median: number;
	max: number;
	/** (max − min) / median; 0 for identical runs, Infinity when runs vary around a zero median. */
	spread: number;
	stable: boolean;
	/** The relative tolerance a ceiling would need: 0 for identical counts, the 2% limit otherwise, null when unstable. */
	tolerance: number | null;
}

export function classifyStability(values: readonly number[]): StabilityVerdict {
	if (values.length === 0) throw new Error("no runs to classify");
	const {min, median, max} = summarize([...values]);
	if (min === max) return {min, median, max, spread: 0, stable: true, tolerance: 0};
	const spread = median === 0 ? Number.POSITIVE_INFINITY : (max - min) / median;
	const stable = spread <= STABILITY_LIMIT;
	return {min, median, max, spread, stable, tolerance: stable ? STABILITY_LIMIT : null};
}

export interface StabilityArgs {
	port: number;
	runs: number;
	journeys: JourneyId[];
	out: string | undefined;
}

export function parseStabilityArgs(argv: readonly string[]): StabilityArgs {
	const labArgv: string[] = [];
	let out: string | undefined;
	let runs = DEFAULT_RUNS;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--out") {
			out = argv[++index];
		} else if (argument === "--runs") {
			runs = Number(argv[++index]);
			if (!Number.isInteger(runs) || runs < 2) throw new Error(`--runs must be at least 2, got ${argv[index]}`);
		} else {
			labArgv.push(argument ?? "");
		}
	}
	const {port, journeys} = parseLabArgs(labArgv);
	return {port, runs, journeys, out};
}

interface MetricRow extends StabilityVerdict {
	journey: string;
	metric: string;
	values: number[];
}

function rowsOf(runs: readonly LabRun[]): MetricRow[] {
	const rows: MetricRow[] = [];
	for (const journey of JOURNEYS) {
		const samples = runs.flatMap((run) => (run[journey] === undefined ? [] : [run[journey]]));
		if (samples.length === 0) continue;
		for (const metric of METRIC_KEYS) {
			const values = samples.map((sample) => sample[metric]);
			rows.push({journey, metric, values, ...classifyStability(values)});
		}
	}
	return rows;
}

/** Medians of float metrics average two values; trim the float noise for display. */
function round(value: number): string {
	return String(Math.round(value * 10_000) / 10_000);
}

function percent(spread: number): string {
	return Number.isFinite(spread) ? `${(spread * 100).toFixed(1)}%` : "∞";
}

function table(rows: readonly MetricRow[], withTolerance: boolean): string {
	const header = withTolerance
		? "| Journey | Metric | min / median / max | Spread | Tolerance |\n|---|---|---|---|---|"
		: "| Journey | Metric | min / median / max | Spread | Values |\n|---|---|---|---|---|";
	const lines = rows.map((row) => {
		const range = [row.min, row.median, row.max].map(round).join(" / ");
		const last = withTolerance
			? row.tolerance === 0
				? "exact"
				: `±${percent(row.tolerance ?? 0)}`
			: row.values.join(", ");
		return `| ${row.journey} | ${row.metric} | ${range} | ${percent(row.spread)} | ${last} |`;
	});
	return [header, ...lines].join("\n");
}

interface StabilityReportInput {
	sha: string;
	createdAt: string;
	chromium: string;
	runs: number;
	loadAverages: Array<{label: string; load: readonly number[]}>;
	rows: MetricRow[];
}

function formatStabilityReport(input: StabilityReportInput): string {
	const stable = input.rows.filter((row) => row.stable);
	const unstable = input.rows.filter((row) => !row.stable);
	const loads = input.loadAverages
		.map(({label, load}) => `| ${label} | ${load.map((value) => value.toFixed(2)).join(" / ")} |`)
		.join("\n");
	const journeys = JOURNEYS.filter((id) => input.rows.some((row) => row.journey === id))
		.map((id) => `${id} ${JOURNEY_TITLES[id]}`)
		.join("; ");
	return `# Browser lab stability

Generated by \`just perf-lab-stability\` at ${input.sha} on ${input.createdAt} (Chromium ${input.chromium}).
${input.runs} runs of the scripts/perf-lab.ts journeys on one fresh fixture server. Journeys: ${journeys}.

A metric is **stable** when every run gives the same value (tolerance: exact), or when (max − min) / median ≤ ${percent(STABILITY_LIMIT)} (tolerance: ±${percent(STABILITY_LIMIT)}). Only stable metrics may get ceilings, at the listed tolerance (plan §4.6, §7 decision 4).

## Load average (1 / 5 / 15 min)

| Point | Load |
|---|---|
${loads}

## Stable (${stable.length})

${stable.length === 0 ? "None." : table(stable, true)}

## Unstable (${unstable.length})

${unstable.length === 0 ? "None." : table(unstable, false)}
`;
}

async function main(): Promise<void> {
	const args = parseStabilityArgs(process.argv.slice(2));
	const loadAverages: StabilityReportInput["loadAverages"] = [{label: "start", load: loadavg()}];
	const session = await runLab({port: args.port, runs: args.runs, journeys: args.journeys}, (run) => {
		loadAverages.push({label: `after run ${run}`, load: loadavg()});
		console.log(`run ${run}/${args.runs} done (load ${loadavg()[0]?.toFixed(2)})`);
	});
	const rows = rowsOf(session.runs);
	const report = formatStabilityReport({
		sha: gitSha(),
		createdAt: new Date().toISOString(),
		chromium: session.chromium,
		runs: args.runs,
		loadAverages,
		rows,
	});
	const out = args.out === undefined ? DEFAULT_OUT : resolve(args.out);
	mkdirSync(dirname(out), {recursive: true});
	writeFileSync(out, report);
	console.log(report);
	console.log(`Wrote ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
