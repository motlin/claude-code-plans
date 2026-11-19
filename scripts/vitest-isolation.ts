import {readdirSync, readFileSync} from "node:fs";
import path from "node:path";

// A file needs its own worker when it renames the process, which would leak into the next file the worker runs. Stubbed
// globals don't count: tests/setup.ts unstubs them after every file. A file that asserts state an earlier file in the
// same worker could change says so with an `@vitest-isolate` comment.
const ISOLATION_MARKERS = [/\bprocess\.title\b/, /@vitest-isolate\b/];

// A file that replaces modules can share a worker, but loads its source modules afresh (tests/reset-modules.ts), since
// modules an earlier file loaded may hold that file's mocks.
const MODULE_RESET_MARKERS = [/\bvi\.(?:mock|doMock|resetModules)\(/];

const DOM_ENVIRONMENT = /@vitest-environment\s+jsdom/;

const TEST_FILE = /\.test\.tsx?$/;

export function needsIsolation(source: string): boolean
{
	return ISOLATION_MARKERS.some((marker) => marker.test(source));
}

export function needsModuleReset(source: string): boolean
{
	return MODULE_RESET_MARKERS.some((marker) => marker.test(source));
}

export function runsInDom(source: string): boolean
{
	return DOM_ENVIRONMENT.test(source);
}

/**
 * Test files under `directory`, relative to `root`, split by whether they need their own worker, whether they share a
 * worker but reload its source modules after them (mocked), and whether they run in node or jsdom. A worker only hands
 * its graph to a file with the same environment, so each environment is its own project.
 */
export function partitionTestFiles(
	root: string,
	directory: string,
):
{
	shared: string[];
	sharedDom: string[];
	mocked: string[];
	mockedDom: string[];
	isolated: string[];
}
{
	const shared: string[] = [];
	const sharedDom: string[] = [];
	const mocked: string[] = [];
	const mockedDom: string[] = [];
	const isolated: string[] = [];
	const files = readdirSync(
		path.join(root, directory),
		{
			recursive: true,
			encoding: "utf8",
		},
	)
		.filter((file) => TEST_FILE.test(file))
		.map((file) => path.posix.join(directory, file.split(path.sep).join("/")))
		.toSorted();
	for (const file of files)
	{
		const source = readFileSync(path.join(root, file), "utf8");
		const dom = runsInDom(source);
		if (needsIsolation(source)) isolated.push(file);
		else if (needsModuleReset(source)) (dom ? mockedDom : mocked).push(file);
		else (dom ? sharedDom : shared).push(file);
	}
	return {
		shared,
		sharedDom,
		mocked,
		mockedDom,
		isolated,
	};
}
