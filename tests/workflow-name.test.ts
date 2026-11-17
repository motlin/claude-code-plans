import {linesHaveWorkflowCall, parseWorkflowMeta, workflowCallName, workflowName} from "../src/lib/workflow-name";

describe("workflowName", () =>
{
	it("follows upstream's input.name → script meta.name → scriptPath basename order", () =>
	{
		expect(
			{
				named: workflowName(
					{
						name: "deep-research",
						script: "export const meta = {name: 'other'}",
						scriptPath: "/x/wf.js",
					},
				),
				emptyName: workflowName(
					{
						name: "",
						scriptPath: "/x/wf.js",
					},
				),
				scriptMeta: workflowName(
					{
						script: 'export const meta = {\n  name: "kalshi-do-all-tasks",\n};',
						scriptPath: "/x/wf.js",
					},
				),
				scriptMetaSingleQuote: workflowName(
					{
						script: "const meta = { description: 'd', name: 'sync' }",
					},
				),
				scriptNoMeta: workflowName(
					{
						script: "await agent('x')",
						scriptPath: "/a/b/run-all.workflow.js",
					},
				),
				scriptMetaPast4096: workflowName(
					{
						script: `${" ".repeat(4096)}const meta = {name: "late"}`,
					},
				),
				scriptPath: workflowName(
					{
						scriptPath: "/x/wf.js",
					},
				),
				scriptPathTrailingSlash: workflowName(
					{
						scriptPath: "/x/wf/",
					},
				),
				scriptPathBackslash: workflowName(
					{
						scriptPath: "C:\\flows\\nightly.ts",
					},
				),
				scriptPathNoExtension: workflowName(
					{
						scriptPath: "/x/.js",
					},
				),
				nothing: workflowName(
					{
						resumeFromRunId: "r1",
					},
				),
				emptyScriptPath: workflowName(
					{
						scriptPath: "",
					},
				),
			},
		).toStrictEqual(
			{
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
			},
		);
	});
});

describe("workflowCallName", () =>
{
	it("reads only a raw tool input's string fields", () =>
	{
		expect(
			{
				scriptPath: workflowCallName(
					{
						scriptPath: "/x/wf.js",
						args:
						{
							dir: "/d",
						},
					},
				),
				nonString: workflowCallName(
					{
						name: 7,
						script: "const meta = {name: 'meta-name'}",
					},
				),
				none: workflowCallName(
					{
						args: [],
					},
				),
			},
		).toStrictEqual(
			{
				scriptPath: "wf",
				nonString: "meta-name",
				none: undefined,
			},
		);
	});
});

describe("parseWorkflowMeta", () =>
{
	it("reads upstream's `ao`: name, description and phases from a line-leading `export const meta` block", () =>
	{
		expect(
			parseWorkflowMeta(
				{
					script:
						'// hi\nexport const meta = {\n  name: \'noop\',\n  description: "Says\\nok \\u00e9 \\"q\\"",\n  ' +
						"nested: {name: 'inner'},\n  phases: [{title: 'A'}, {title: `B`, detail: 'b {x}'}],\n}\nrun()\n",
				},
			),
		).toStrictEqual(
			{
				name: "noop",
				description: 'Says ok \\u00e9 "q"',
				phases: [
					{
						title: "A",
					},
					{
						title: "B",
						detail: "b {x}",
					},
				],
			},
		);
	});

	it("prefers a non-empty input.name, then the meta name, then upstream's `g` fallback", () =>
	{
		expect(
			{
				named: parseWorkflowMeta(
					{
						name: "x",
						description: "Ignored",
						script: "export const meta = {name: 'm', description: 'd'}",
					},
				),
				emptyName: parseWorkflowMeta(
					{
						name: "",
						script: "export const meta = {name: 'm'}",
					},
				),
				noMetaName: parseWorkflowMeta(
					{
						script: "export const meta = {description: 'd'}",
						scriptPath: "/s/runs/sync-wf.js",
					},
				),
				scriptPathOnly: parseWorkflowMeta(
					{
						scriptPath: "/s/runs/sync-wf.js",
						description: "Ignored",
					},
				),
				nothing: parseWorkflowMeta(
					{
						args: {},
					},
				),
			},
		).toStrictEqual(
			{
				named:
				{
					name: "x",
					description: "d",
				},
				emptyName:
				{
					name: "m",
				},
				noMetaName:
				{
					name: "sync-wf",
					description: "d",
				},
				scriptPathOnly:
				{
					name: "sync-wf",
				},
				nothing: {},
			},
		);
	});

	it("skips a meta block inside a comment or string, falling back to the meta regex or scriptPath", () =>
	{
		expect(
			{
				commented: parseWorkflowMeta(
					{
						script: "/*\nexport const meta = {name: 'hidden', description: 'd'}\n*/\nrun()",
						scriptPath: "/s/wf.mjs",
					},
				),
				quoted: parseWorkflowMeta(
					{
						script: "const s = `\nexport const meta = {description: 'd'}`",
						scriptPath: "/s/wf.mjs",
					},
				),
				notLineLeading: parseWorkflowMeta(
					{
						script: "x; export const meta = {name: 'late', description: 'd'}",
					},
				),
			},
		).toStrictEqual(
			{
				commented:
				{
					name: "hidden",
				},
				quoted:
				{
					name: "wf",
				},
				notLineLeading:
				{
					name: "late",
				},
			},
		);
	});
});

describe("linesHaveWorkflowCall", () =>
{
	it("finds a Workflow tool_use in an assistant line only", () =>
	{
		const call = (name: string) => (
		{
			type: "assistant",
			message:
			{
				content: [
					{
						type: "text",
						text: "hi",
					},
					{
						type: "tool_use",
						id: "t",
						name,
						input: {},
					},
				],
			},
		});
		expect(
			{
				workflow: linesHaveWorkflowCall([
					{
						type: "user",
						message:
						{
							content: "x",
						},
					},
					call("Workflow"),
				]),
				bash: linesHaveWorkflowCall([call("Bash")]),
				userEcho: linesHaveWorkflowCall([
					{
						type: "user",
						message:
						{
							content: [
								{
									type: "tool_use",
									name: "Workflow",
								},
							],
						},
					},
				]),
				empty: linesHaveWorkflowCall([]),
			},
		).toStrictEqual(
			{
				workflow: true,
				bash: false,
				userEcho: false,
				empty: false,
			},
		);
	});
});
