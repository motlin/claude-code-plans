import {createInterface, type Interface} from "node:readline";
import type {Readable} from "node:stream";

/**
 * A readline interface over `input` that also destroys `input` when the interface closes. `rl.close()` on its own
 * only pauses the input, so a loop that stops before EOF (a `break`, an early `return`, a throw) would otherwise leave
 * the ReadStream, its file descriptor and its buffered chunk open for the life of the process.
 */
export function createLineReader(input: Readable): Interface {
	const rl = createInterface({input, crlfDelay: Infinity});
	rl.once("close", () => input.destroy());
	return rl;
}
