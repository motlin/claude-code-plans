import {beforeAll, vi} from "vite-plus/test";
import {forgetImporters, forgetMockModules, type ModuleGraph} from "./mock-module-graph";

type MockPath = (originalId: string, id: string, ...rest: unknown[]) => void;

declare global
{
	/** Vitest's per-worker state, whose module graph vi.resetModules resets. */
	var __vitest_worker__:
	{
		evaluatedModules: ModuleGraph;
	};
	/** The worker's module mocker, which registers each vi.mock call against the resolved module id. */
	var __vitest_mocker__:
	{
		mockPath: MockPath;
	};
}

const graph = globalThis.__vitest_worker__.evaluatedModules;

// Files that mock modules share a worker's environment and node_modules, but each starts with none of its source
// modules loaded, as an isolated worker would: anything an earlier file evaluated may hold that file's mocks. This runs
// before tests/setup.ts and the test file import anything. Resetting when a file starts rather than when it ends also
// catches modules an earlier file's late dynamic import evaluated after it ended, still under its mocks.
vi.resetModules();

// vi.resetModules keeps evaluated mock modules, so a file mocking a path an earlier file mocked would get that file's
// factory result. Forget them too, as isolation does.
forgetMockModules(graph);

// An earlier file's late import can still evaluate source modules after the reset, before this file's vi.mock calls
// register (while the worker fetches this file), binding them to the real module. So until the file is collected, each
// mock it registers also forgets the modules that import the mocked one, and this file's imports evaluate them afresh.
// vi.doMock calls in tests come after and keep vitest's semantics: they only reach later imports.
const mocker = globalThis.__vitest_mocker__;
// The worker keeps one mocker across files: drop the previous file's wrapper to reach vitest's own method.
Reflect.deleteProperty(mocker, "mockPath");
const registerMock = mocker.mockPath;
let collecting = true;
mocker.mockPath = function (this: typeof mocker, originalId, id, ...rest)
{
	if (collecting) forgetImporters(graph, id);
	registerMock.call(this, originalId, id, ...rest);
};
beforeAll(() =>
{
	collecting = false;
});
