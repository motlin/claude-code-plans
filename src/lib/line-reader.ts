import {createInterface} from "node:readline";
import type {Readable} from "node:stream";

/** Lines of a stream, read with `for await`, whose `close()` resolves once the stream has released its descriptor. */
export interface LineReader extends AsyncIterable<string> {
	close(): Promise<void>;
}

/**
 * Destroys `stream` and resolves once it has emitted `close`. A file ReadStream closes its descriptor on the libuv
 * threadpool after `destroy()` returns, so a reader that only destroys it resolves while the descriptor is still open,
 * for as long as the threadpool is busy.
 */
export function destroyStream(stream: Readable): Promise<void> {
	if (stream.closed) return Promise.resolve();
	const closed = new Promise<void>((resolve) => stream.once("close", () => resolve()));
	stream.destroy();
	return closed;
}

/**
 * A line reader over `input` whose `close()` also destroys `input` and waits for it to close. Closing a readline
 * interface on its own only pauses the input, so a loop that stops before EOF (a `break`, an early `return`, a throw)
 * would otherwise leave the ReadStream, its file descriptor and its buffered chunk open for the life of the process.
 */
export function createLineReader(input: Readable): LineReader {
	const rl = createInterface({input, crlfDelay: Infinity});
	return {
		[Symbol.asyncIterator]: () => rl[Symbol.asyncIterator](),
		close: () => {
			rl.close();
			return destroyStream(input);
		},
	};
}
