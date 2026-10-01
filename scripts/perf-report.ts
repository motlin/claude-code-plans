/**
 * Field perf report (plan .llm/perf/measurement-plan.md §4.5, §7 decision 3). Reads the journey samples the server
 * sink appends to `<cacheDir>/perf/field-YYYY-MM-DD.jsonl` and prints n and nearest-rank p50/p75/p95 per F metric,
 * split into server, network and client time, for each build SHA, mode, origin, form factor and size bucket.
 * Baselines are the p75 of a bucket with at least 30 samples.
 *
 * Usage: just perf-report [--since 7d] [--sha X]
 */

import {readdirSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {getCacheDir} from "../src/lib/db/connection";
import {FIELD_LOG_PATTERN, JourneySampleSchema} from "../src/lib/perf/field-sink";
import type {JourneySample} from "../src/lib/perf/journey";

const BASELINE_MIN_SAMPLES = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const PERCENTILES = [50, 75, 95] as const;
const SINCE_PATTERN = /^(\d+)d$/;

export interface ReportArgs {
	sinceDays?: number;
	sha?: string;
}

export interface ReadOptions extends ReportArgs {
	now: Date;
}

export interface SampleSplit {
	total: number;
	server: number;
	network: number;
	client: number;
}

const SPLIT_KEYS = ["total", "server", "network", "client"] as const satisfies readonly (keyof SampleSplit)[];

export function parseReportArgs(argv: readonly string[]): ReportArgs {
	const args: ReportArgs = {};
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (flag === "--since") {
			const days = SINCE_PATTERN.exec(value ?? "")?.[1];
			if (days === undefined) throw new Error(`--since expects a day count like "7d", got "${value ?? ""}"`);
			args.sinceDays = Number(days);
			index++;
		} else if (flag === "--sha") {
			if (value === undefined) throw new Error("--sha expects a build SHA prefix");
			args.sha = value;
			index++;
		} else {
			throw new Error(`Unknown argument "${flag}". Usage: just perf-report [--since 7d] [--sha X]`);
		}
	}
	return args;
}

/** Reads the field logs dated within the last `sinceDays` (all of them when unset), keeping builds whose SHA starts with `sha`. */
export function readFieldSamples(
	perfDir: string,
	{now, sinceDays, sha}: ReadOptions,
): {samples: JourneySample[]; invalidLines: number} {
	const cutoff =
		sinceDays === undefined ? "" : new Date(now.getTime() - sinceDays * DAY_MS).toISOString().slice(0, 10);
	const samples: JourneySample[] = [];
	let invalidLines = 0;
	for (const name of readdirSync(perfDir).sort()) {
		const day = FIELD_LOG_PATTERN.exec(name)?.[1];
		if (day === undefined || day < cutoff) continue;
		for (const line of readFileSync(join(perfDir, name), "utf-8").split("\n")) {
			if (line.trim() === "") continue;
			let json: unknown;
			try {
				json = JSON.parse(line);
			} catch {
				invalidLines++;
				continue;
			}
			const parsed = JourneySampleSchema.safeParse(json);
			if (!parsed.success) {
				invalidLines++;
				continue;
			}
			if (sha === undefined || parsed.data.buildSha.startsWith(sha)) samples.push(parsed.data);
		}
	}
	return {samples, invalidLines};
}

/** The nearest-rank percentile: the value at rank ceil(p/100 * n) of the sorted values. */
export function nearestRank(values: readonly number[], percentile: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
	return sorted[rank - 1]!;
}

/**
 * Splits a journey's duration. Requests overlapping the journey window are clipped to it and their union is the
 * time spent waiting on the network; server time is the sum of their `Server-Timing: total`, capped at that union;
 * network is the rest of the union; client is the time no request was in flight.
 */
export function splitSample(sample: JourneySample): SampleSplit {
	const windowEnd = sample.start + sample.duration;
	const inWindow = sample.resources.filter(
		(resource) => resource.responseEnd > sample.start && resource.startTime < windowEnd,
	);
	const intervals = inWindow
		.map(
			(resource) =>
				[Math.max(resource.startTime, sample.start), Math.min(resource.responseEnd, windowEnd)] as const,
		)
		.sort((a, b) => a[0] - b[0]);
	let inFlight = 0;
	let coveredUntil = sample.start;
	for (const [start, end] of intervals) {
		if (end <= coveredUntil) continue;
		inFlight += end - Math.max(start, coveredUntil);
		coveredUntil = end;
	}
	const serverTotal = inWindow
		.flatMap((resource) => resource.serverTiming)
		.filter((entry) => entry.name === "total")
		.reduce((sum, entry) => sum + entry.duration, 0);
	const server = Math.min(serverTotal, inFlight);
	return {total: sample.duration, server, network: inFlight - server, client: sample.duration - inFlight};
}

function bucketKey(sample: JourneySample): string[] {
	return [sample.buildSha, sample.mode, sample.origin, sample.formFactor, sample.sizeBucket ?? "-", sample.journey];
}

function compareCells(a: string, b: string): number {
	const metricA = /^F(\d+)$/.exec(a)?.[1];
	const metricB = /^F(\d+)$/.exec(b)?.[1];
	if (metricA !== undefined && metricB !== undefined) return Number(metricA) - Number(metricB);
	return a < b ? -1 : a > b ? 1 : 0;
}

function compareKeys(a: readonly string[], b: readonly string[]): number {
	for (let index = 0; index < a.length; index++) {
		const order = compareCells(a[index]!, b[index]!);
		if (order !== 0) return order;
	}
	return 0;
}

function percentileCell(values: readonly number[]): string {
	return PERCENTILES.map((percentile) => String(Math.round(nearestRank(values, percentile)))).join("/");
}

export function formatReport(samples: readonly JourneySample[]): string {
	if (samples.length === 0) return "No field perf samples recorded.";

	const buckets = new Map<string, {key: string[]; splits: SampleSplit[]}>();
	for (const sample of samples) {
		const key = bucketKey(sample);
		const id = JSON.stringify(key);
		const bucket = buckets.get(id) ?? {key, splits: []};
		bucket.splits.push(splitSample(sample));
		buckets.set(id, bucket);
	}

	const rows = [...buckets.values()]
		.sort((a, b) => compareKeys(a.key, b.key))
		.map(({key, splits}) => [
			...key,
			String(splits.length),
			...SPLIT_KEYS.map((part) => percentileCell(splits.map((split) => split[part]))),
			splits.length >= BASELINE_MIN_SAMPLES ? "yes" : `not yet (n < ${BASELINE_MIN_SAMPLES})`,
		]);
	const header = [
		"sha",
		"mode",
		"origin",
		"form",
		"size",
		"metric",
		"n",
		...SPLIT_KEYS.map((part) => `${part} p50/p75/p95`),
		"baseline",
	];
	const table = [header, ...rows];
	const firstNumeric = 6;
	const lastColumn = header.length - 1;
	const widths = header.map((_, column) => Math.max(...table.map((row) => row[column]!.length)));
	return table
		.map((row) =>
			row
				.map((cell, column) =>
					column === lastColumn
						? cell
						: column >= firstNumeric
							? cell.padStart(widths[column]!)
							: cell.padEnd(widths[column]!),
				)
				.join("  "),
		)
		.join("\n");
}

function main(): void {
	let args: ReportArgs;
	try {
		args = parseReportArgs(process.argv.slice(2));
	} catch (error) {
		console.error((error as Error).message);
		process.exitCode = 2;
		return;
	}
	const perfDir = join(getCacheDir(), "perf");
	let result: {samples: JourneySample[]; invalidLines: number};
	try {
		result = readFieldSamples(perfDir, {now: new Date(), ...args});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		result = {samples: [], invalidLines: 0};
	}
	console.log(formatReport(result.samples));
	if (result.invalidLines > 0) {
		console.error(`Skipped ${result.invalidLines} line(s) that are not valid field samples.`);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
