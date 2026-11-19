import {vi} from "vite-plus/test";

interface EvaluatedModule
{
	promise: unknown;
	exports: unknown;
	evaluated: boolean;
	importers: Set<string>;
}

declare global
{
	/** Vitest's per-worker state, whose module graph vi.resetModules resets. */
	var __vitest_worker__:
	{
		evaluatedModules:
		{
			idToModuleMap: Map<string, EvaluatedModule>;
		};
	};
}

// Files that mock modules share a worker's environment and node_modules, but each starts with none of its source
// modules loaded, as an isolated worker would: anything an earlier file evaluated may hold that file's mocks. This runs
// before tests/setup.ts and the test file import anything. Resetting when a file starts rather than when it ends also
// catches modules an earlier file's late dynamic import evaluated after it ended, still under its mocks.
vi.resetModules();

// vi.resetModules keeps evaluated mock modules, so a file mocking a path an earlier file mocked would get that file's
// factory result. Forget them too, as isolation does.
for (const [id, node] of globalThis.__vitest_worker__.evaluatedModules.idToModuleMap)
{
	if (!id.startsWith("mock:")) continue;
	node.promise = undefined;
	node.exports = undefined;
	node.evaluated = false;
	node.importers.clear();
}
