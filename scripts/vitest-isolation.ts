import {readdirSync, readFileSync} from "node:fs";
import path from "node:path";

// A file needs its own module graph when it replaces modules, stubs globals or renames the process: under
// isolate: false any of these would leak into the next file the worker runs. A file that asserts a module's
// first-load state says so with an `@vitest-isolate` comment.
const ISOLATION_MARKERS = [
	/\bvi\.(?:mock|doMock|resetModules|stubGlobal)\(/,
	/\bprocess\.title\b/,
	/@vitest-isolate\b/,
];

const DOM_ENVIRONMENT = /@vitest-environment\s+jsdom/;

const TEST_FILE = /\.test\.tsx?$/;

export function needsIsolation(source: string): boolean {
	return ISOLATION_MARKERS.some((marker) => marker.test(source));
}

export function runsInDom(source: string): boolean {
	return DOM_ENVIRONMENT.test(source);
}

/**
 * Test files under `directory`, relative to `root`, split by whether they need an isolated module graph and, when
 * they can share one, whether they share a node or a jsdom worker. A worker only hands its graph to a file with the
 * same environment, so the two shared kinds are separate projects.
 */
export function partitionTestFiles(
	root: string,
	directory: string,
): {shared: string[]; sharedDom: string[]; isolated: string[]} {
	const shared: string[] = [];
	const sharedDom: string[] = [];
	const isolated: string[] = [];
	const files = readdirSync(path.join(root, directory), {recursive: true, encoding: "utf8"})
		.filter((file) => TEST_FILE.test(file))
		.map((file) => path.posix.join(directory, file.split(path.sep).join("/")))
		.toSorted();
	for (const file of files) {
		const source = readFileSync(path.join(root, file), "utf8");
		if (needsIsolation(source)) isolated.push(file);
		else if (runsInDom(source)) sharedDom.push(file);
		else shared.push(file);
	}
	return {shared, sharedDom, isolated};
}
