import {createReadStream} from "node:fs";
import {Readable} from "node:stream";

/** A web ReadableStream over a file on disk, typed as the body `new Response(...)` expects. */
export function fileBodyStream(path: string): ReadableStream<Uint8Array> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Readable.toWeb returns node:stream/web's ReadableStream, the same runtime class as the DOM global Response takes; only the type declarations differ
	return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
}
