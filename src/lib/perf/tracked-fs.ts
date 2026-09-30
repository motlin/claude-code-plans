import {createReadStream, readFileSync, type ReadStream} from "node:fs";
import {currentPerfCounters} from "./server-scope";

/**
 * `createReadStream` that reports into the active perf scope: every byte read from disk adds to
 * `jsonl.bytesRead`, and a stream that starts at offset 0 and reaches EOF counts one `jsonl.fullScans`.
 */
export function trackedCreateReadStream(path: string, options: {encoding: BufferEncoding; start?: number}): ReadStream {
	const stream = createReadStream(path, options);
	const counters = currentPerfCounters();
	if (counters === undefined) return stream;

	const fromStart = (options.start ?? 0) === 0;
	const push = stream.push.bind(stream);
	Object.defineProperty(stream, "push", {
		configurable: true,
		writable: true,
		value(chunk: unknown, encoding?: BufferEncoding): boolean {
			if (chunk === null) {
				if (fromStart) counters.jsonl.fullScans += 1;
			} else if (Buffer.isBuffer(chunk)) {
				counters.jsonl.bytesRead += chunk.length;
			}
			return push(chunk, encoding);
		},
	});
	return stream;
}

/** `readFileSync(path, "utf-8")` that reports the whole file as bytes read and one full scan. */
export function trackedReadFileSync(path: string): string {
	const buffer = readFileSync(path);
	const counters = currentPerfCounters();
	if (counters !== undefined) {
		counters.jsonl.bytesRead += buffer.length;
		counters.jsonl.fullScans += 1;
	}
	return buffer.toString("utf-8");
}
