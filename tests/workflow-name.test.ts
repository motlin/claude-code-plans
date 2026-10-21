import {workflowName} from "../src/lib/workflow-name";

describe("workflowName", () => {
	it("follows upstream's input.name → script meta.name → scriptPath basename order", () => {
		expect({
			named: workflowName({
				name: "deep-research",
				script: "export const meta = {name: 'other'}",
				scriptPath: "/x/wf.js",
			}),
			emptyName: workflowName({name: "", scriptPath: "/x/wf.js"}),
			scriptMeta: workflowName({
				script: 'export const meta = {\n  name: "kalshi-do-all-tasks",\n};',
				scriptPath: "/x/wf.js",
			}),
			scriptMetaSingleQuote: workflowName({script: "const meta = { description: 'd', name: 'sync' }"}),
			scriptNoMeta: workflowName({script: "await agent('x')", scriptPath: "/a/b/run-all.workflow.js"}),
			scriptMetaPast4096: workflowName({script: `${" ".repeat(4096)}const meta = {name: "late"}`}),
			scriptPath: workflowName({scriptPath: "/x/wf.js"}),
			scriptPathTrailingSlash: workflowName({scriptPath: "/x/wf/"}),
			scriptPathBackslash: workflowName({scriptPath: "C:\\flows\\nightly.ts"}),
			scriptPathNoExtension: workflowName({scriptPath: "/x/.js"}),
			nothing: workflowName({resumeFromRunId: "r1"}),
			emptyScriptPath: workflowName({scriptPath: ""}),
		}).toStrictEqual({
			named: "deep-research",
			emptyName: "wf",
			scriptMeta: "kalshi-do-all-tasks",
			scriptMetaSingleQuote: "sync",
			scriptNoMeta: "run-all.workflow",
			scriptMetaPast4096: undefined,
			scriptPath: "wf",
			scriptPathTrailingSlash: "wf",
			scriptPathBackslash: "nightly",
			scriptPathNoExtension: ".js",
			nothing: undefined,
			emptyScriptPath: undefined,
		});
	});
});
