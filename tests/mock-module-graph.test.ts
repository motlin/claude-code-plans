import {EvaluatedModules} from "vite/module-runner";
import {describe, expect, it} from "vite-plus/test";
import {forgetImporters, forgetMockModules} from "./mock-module-graph";

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

	it("drops every module that imports a newly mocked path, and the source modules its direct importers handed it to", () =>
	{
		const graph = new EvaluatedModules();
		const engine = graph.ensureModule("/src/lib/shrinkwrap.ts", "/src/lib/shrinkwrap.ts");
		const useShrinkwrap = graph.ensureModule("/src/hooks/use-shrinkwrap.ts", "/src/hooks/use-shrinkwrap.ts");
		const loader = graph.ensureModule("/src/lib/shrinkwrap-loader.ts", "/src/lib/shrinkwrap-loader.ts");
		const tooltip = graph.ensureModule("/src/components/ui/tooltip.tsx", "/src/components/ui/tooltip.tsx");
		const react = graph.ensureModule("/node_modules/react/index.js", "/node_modules/react/index.js");
		const unrelated = graph.ensureModule("/src/lib/defined.ts", "/src/lib/defined.ts");
		// use-shrinkwrap provides the engine it imports to the loader it imports, which tooltip reads it from.
		engine.importers.add(useShrinkwrap.id);
		useShrinkwrap.imports.add(engine.id).add(loader.id).add(react.id);
		loader.importers.add(useShrinkwrap.id).add(tooltip.id);
		react.importers.add(useShrinkwrap.id).add(tooltip.id);
		// A cycle back to the loader must not loop.
		tooltip.importers.add(loader.id);

		forgetImporters(graph, engine.id);

		expect(
			{
				engine: graph.getModuleById(engine.id) === engine,
				useShrinkwrap: graph.getModuleById(useShrinkwrap.id),
				loader: graph.getModuleById(loader.id),
				loaderByUrl: graph.getModuleByUrl(loader.url),
				loaderInFileMap: graph.getModulesByFile(loader.file)?.has(loader),
				tooltip: graph.getModuleById(tooltip.id),
				react: graph.getModuleById(react.id) === react,
				unrelated: graph.getModuleById(unrelated.id) === unrelated,
			},
		).toStrictEqual(
			{
				engine: true,
				useShrinkwrap: undefined,
				loader: undefined,
				loaderByUrl: undefined,
				loaderInFileMap: false,
				tooltip: undefined,
				react: true,
				unrelated: true,
			},
		);
	});
});
