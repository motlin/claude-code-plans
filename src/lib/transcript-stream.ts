import {createReadStream} from "node:fs";
import {destroyStream} from "./line-reader";

const READ_CHUNK_BYTES = 1024 * 1024;
const NEWLINE = 0x0a;
const CLOSING_BRACE = 0x7d;
/** How the CLI writes every `api-request` record: the raw request body, 80% of a long transcript's bytes. */
const API_REQUEST_PREFIX = Buffer.from('{"type":"api-request",');

function isApiRequestLine(buffer: Buffer, start: number, end: number): boolean
{
	return (
		end - start > API_REQUEST_PREFIX.length &&
		buffer[end - 1] === CLOSING_BRACE &&
		buffer.compare(API_REQUEST_PREFIX, 0, API_REQUEST_PREFIX.length, start, start + API_REQUEST_PREFIX.length) === 0
	);
}

/**
 * Calls `onLine` with each non-blank line of a transcript, oldest first, streaming it in chunks. `api-request` lines
 * are skipped before they are decoded. Reading a long transcript with `readFile(path, "utf8")` instead held the whole
 * file as one string per call: eleven overlapping reads of a 386 MB transcript filled the 4 GB heap.
 */
export async function forEachTranscriptLine(
	filePath: string,
	onLine: (line: string) => void,
	chunkBytes = READ_CHUNK_BYTES,
): Promise<void>
{
	const emit = (buffer: Buffer, start: number, end: number) =>
	{
		if (isApiRequestLine(buffer, start, end)) return;
		let line = buffer.toString("utf8", start, end);
		if (line.endsWith("\r")) line = line.slice(0, -1);
		if (line.trim()) onLine(line);
	};
	const stream = createReadStream(
		filePath,
		{
			highWaterMark: chunkBytes,
		},
	);
	let carry: Buffer | undefined;
	try
	{
		for await (const chunk of stream as AsyncIterable<Buffer>)
		{
			const buffer = carry === undefined ? chunk : Buffer.concat([carry, chunk]);
			let position = 0;
			for (let newline = buffer.indexOf(NEWLINE); newline !== -1; newline = buffer.indexOf(NEWLINE, position))
			{
				emit(buffer, position, newline);
				position = newline + 1;
			}
			carry = position < buffer.length ? Buffer.from(buffer.subarray(position)) : undefined;
		}
	}
	finally
	{
		await destroyStream(stream);
	}
	if (carry !== undefined) emit(carry, 0, carry.length);
}

/**
 * Wraps `run` so each key has at most one call running. A caller that arrives while one runs gets the single
 * follow-up run started once it settles, shared with every other caller that arrived meanwhile, so it still sees the
 * file as of after its request. A burst of requests for one long transcript then costs two whole reads, not one each.
 */
export function coalescePerKey<T>(run: (key: string) => Promise<T>): (key: string) => Promise<T>
{
	const running = new Map<string, Promise<T>>();
	const queued = new Map<string, Promise<T>>();

	const start = async (key: string): Promise<T> =>
	{
		const promise = run(key);
		running.set(key, promise);
		const clear = () =>
		{
			if (running.get(key) === promise) running.delete(key);
		};
		promise.then(clear, clear);
		return promise;
	};

	return async (key) =>
	{
		const current = running.get(key);
		if (current === undefined) return start(key);
		const waiting = queued.get(key);
		if (waiting !== undefined) return waiting;
		const next = current
			.catch(() => undefined)
			.then(async () =>
			{
				queued.delete(key);
				return start(key);
			});
		queued.set(key, next);
		return next;
	};
}
