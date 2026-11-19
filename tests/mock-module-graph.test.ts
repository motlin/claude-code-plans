import {EvaluatedModules} from "vite/module-runner";
import {describe, expect, it} from "vite-plus/test";
import {forgetMockModules} from "./mock-module-graph";

describe("forgetMockModules", () =>
{
	it("hands the next import of a mocked path a fresh node, out of reach of an earlier file's factory still running", () =>
	{
		const graph = new EvaluatedModules();
		const earlierMock = graph.ensureModule("mock:/src/hooks/use-shiki.ts", "/src/hooks/use-shiki.ts");
		const source = graph.ensureModule("/src/lib/defined.ts", "/src/lib/defined.ts");
		source.evaluated = true;

		forgetMockModules(graph);
		const nextMock = graph.ensureModule("mock:/src/hooks/use-shiki.ts", "/src/hooks/use-shiki.ts");
		// The earlier file's factory settles after this file registered its mock, writing onto the node it started with.
		earlierMock.exports =
		{
			from: "earlier file",
		};

		expect(
			{
				nextMockExports: nextMock.exports,
				nextMockByUrl: graph.getModuleByUrl("/src/hooks/use-shiki.ts") === nextMock,
				earlierMockInFileMap: graph.getModulesByFile(earlierMock.file)?.has(earlierMock),
				sourceKept: graph.getModuleById("/src/lib/defined.ts") === source && source.evaluated,
			},
		).toStrictEqual(
			{
				nextMockExports: undefined,
				nextMockByUrl: true,
				earlierMockInFileMap: false,
				sourceKept: true,
			},
		);
	});
});
