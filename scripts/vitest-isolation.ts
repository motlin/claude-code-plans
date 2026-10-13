import {readdirSync, readFileSync} from "node:fs";
import path from "node:path";

// A file needs its own module graph when it swaps in a DOM, replaces modules, stubs globals
// or renames the process: under isolate: false any of these would leak into the next file
// the worker runs.
const ISOLATION_MARKERS = [
	/@vitest-environment\s+jsdom/,
	/\bvi\.(?:mock|doMock|resetModules|stubGlobal)\(/,
	/\bprocess\.title\b/,
];

const TEST_FILE = /\.test\.tsx?$/;

export function needsIsolation(source: string): boolean {
	return ISOLATION_MARKERS.some((marker) => marker.test(source));
}

/** Test files under `directory`, relative to `root`, split by whether they need an isolated module graph. */
export function partitionTestFiles(root: string, directory: string): {shared: string[]; isolated: string[]} {
	const shared: string[] = [];
	const isolated: string[] = [];
	const files = readdirSync(path.join(root, directory), {recursive: true, encoding: "utf8"})
		.filter((file) => TEST_FILE.test(file))
		.map((file) => path.posix.join(directory, file.split(path.sep).join("/")))
		.toSorted();
	for (const file of files) {
		(needsIsolation(readFileSync(path.join(root, file), "utf8")) ? isolated : shared).push(file);
	}
	return {shared, isolated};
}
