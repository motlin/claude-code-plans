import {currentPerfCounters, withPerfScope, type PerfCounters} from "./server-scope";

type FetchHandler = (request: Request) => Response | Promise<Response>;

function formatMs(ms: number): string {
	return ms.toFixed(1);
}

function serverTimingHeader(totalMs: number, counters: PerfCounters): string {
	return [
		`total;dur=${formatMs(totalMs)}`,
		`db;dur=${formatMs(counters.sql.ms)};desc="q=${counters.sql.count}"`,
		`jsonl;desc="b=${counters.jsonl.bytesRead};s=${counters.jsonl.fullScans}"`,
		`proc;desc="n=${counters.proc.spawned}"`,
	].join(", ");
}

function isEventStream(response: Response): boolean {
	return response.headers.get("content-type")?.startsWith("text/event-stream") ?? false;
}

function withHeader(response: Response, value: string): Response {
	try {
		response.headers.set("Server-Timing", value);
		return response;
	} catch {
		// Responses like Response.redirect() have immutable headers.
		const headers = new Headers(response.headers);
		headers.set("Server-Timing", value);
		return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
	}
}

/**
 * Runs each request inside an "http" perf scope and reports its counters in a
 * Server-Timing header, which the field beacon reads from resource entries.
 * SSE responses are skipped: their handler time says nothing about the stream.
 * With CCB_PERF_LOG=1 each request also logs one JSON line to stdout.
 */
export function withServerTiming(handler: FetchHandler): (request: Request) => Promise<Response> {
	return (request) =>
		withPerfScope("http", async () => {
			const start = performance.now();
			const response = await handler(request);
			const totalMs = performance.now() - start;
			if (isEventStream(response)) return response;

			const counters = currentPerfCounters()!;
			if (process.env["CCB_PERF_LOG"] === "1") {
				console.log(
					JSON.stringify({
						perf: "http",
						method: request.method,
						path: new URL(request.url).pathname,
						status: response.status,
						totalMs: Number(formatMs(totalMs)),
						sqlCount: counters.sql.count,
						sqlMs: Number(formatMs(counters.sql.ms)),
						jsonlBytesRead: counters.jsonl.bytesRead,
						jsonlFullScans: counters.jsonl.fullScans,
						procSpawned: counters.proc.spawned,
					}),
				);
			}
			return withHeader(response, serverTimingHeader(totalMs, counters));
		});
}
