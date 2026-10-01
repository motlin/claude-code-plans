/**
 * The per-shape ceiling ids the server lab benchmarks ratchet, in one place so a test can check that every shaped
 * ceiling in ceilings.json is exercised and every exercised id has a ceiling.
 */

const SESSION_OPEN_ENDPOINTS = ["detail", "transcript", "subagents"] as const;
export type SessionOpenEndpoint = (typeof SESSION_OPEN_ENDPOINTS)[number];

const SESSION_OPEN_METRICS = ["sql.count", "jsonl.bytesRead", "jsonl.fullScans", "proc.spawned", "resp.bytes"] as const;
export type SessionOpenMetric = (typeof SESSION_OPEN_METRICS)[number];

export const LIVE_APPEND_SIZES = [1, 20] as const;

const LIVE_APPEND_METRICS = ["readAmplification", "jsonl.fullScans", "sql.count", "sse.payloadBytes"] as const;
export type LiveAppendMetric = (typeof LIVE_APPEND_METRICS)[number];

export function sessionOpenPrefix(shape: string, endpoint: SessionOpenEndpoint): string {
	return `server.sessionOpen.${shape}.${endpoint}`;
}

export function liveAppendPrefix(shape: string, count: number): string {
	return `server.liveAppend.${shape}.${count}`;
}

/** Prefixes each metric name with `prefix.`, so the type checker holds a benchmark to its full metric list. */
export function metricIds<Metric extends string>(
	prefix: string,
	values: Record<Metric, number>,
): Record<string, number> {
	return Object.fromEntries(Object.entries<number>(values).map(([metric, value]) => [`${prefix}.${metric}`, value]));
}

export function shapeMetricIds(shape: string): string[] {
	return [
		...SESSION_OPEN_ENDPOINTS.flatMap((endpoint) =>
			SESSION_OPEN_METRICS.map((metric) => `${sessionOpenPrefix(shape, endpoint)}.${metric}`),
		),
		...LIVE_APPEND_SIZES.flatMap((count) =>
			LIVE_APPEND_METRICS.map((metric) => `${liveAppendPrefix(shape, count)}.${metric}`),
		),
	];
}
