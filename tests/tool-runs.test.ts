import {describe, expect, it} from "vite-plus/test";

import
{
	coalesceSameTarget,
	rendersBare,
	type RunCall,
	runSuffix,
	sameTarget,
	splitRuns,
	targetKey,
	toolBucket,
	type ToolBucket,
	type RunSuffixCall,
} from "../src/lib/tool-runs";

let nextId = 0;
function call(name: string, input: Record<string, unknown> = {}, extra: Partial<RunCall> = {}): RunCall
{
	nextId += 1;
	return {
		id: `t${nextId}`,
		name,
		input,
		...extra,
	};
}

describe("toolBucket", () =>
{
	const cases: [string, RunCall, ToolBucket][] = [
		["AskUserQuestion", call("AskUserQuestion"), "standalone"],
		["ExitPlanMode", call("ExitPlanMode"), "standalone"],
		["SendUserMessage", call("SendUserMessage"), "standalone"],
		["SendUserFile", call("SendUserFile"), "standalone"],
		["Workflow", call("Workflow"), "standalone"],
		["ReportFindings", call("ReportFindings"), "standalone"],
		["ClaudeDesign", call("ClaudeDesign"), "standalone"],
		["mcp__ccd_turn__wrap_up", call("mcp__ccd_turn__wrap_up"), "standalone"],
		["Artifact {}", call("Artifact"), "default"],
		[
			"Artifact read_db",
			call(
				"Artifact",
				{
					action: "read_db",
				},
			),
			"default",
		],
		[
			"Artifact quickstart",
			call(
				"Artifact",
				{
					action: "quickstart",
				},
			),
			"default",
		],
		[
			"Artifact list",
			call(
				"Artifact",
				{
					action: "list",
				},
			),
			"default",
		],
		[
			"Artifact path only",
			call(
				"Artifact",
				{
					path: "x.html",
				},
			),
			"standalone",
		],
		[
			"Artifact edit",
			call(
				"Artifact",
				{
					action: "edit",
				},
			),
			"standalone",
		],
		[
			"Artifact open",
			call(
				"Artifact",
				{
					action: "open",
				},
			),
			"standalone",
		],
		[
			"Artifact errored publish",
			call(
				"Artifact",
				{
					action: "publish",
				},
				{
					isError: true,
				},
			),
			"standalone",
		],
		[
			"PushNotification requested",
			call(
				"PushNotification",
				{},
				{
					result: "Terminal notification sent. Mobile push requested.",
				},
			),
			"default",
		],
		[
			"PushNotification remote control inactive",
			call(
				"PushNotification",
				{},
				{
					result: "Terminal notification sent. Mobile push not sent (Remote Control inactive).",
				},
			),
			"standalone",
		],
		[
			"PushNotification terminal active",
			call(
				"PushNotification",
				{},
				{
					result: "Not sent — this terminal is active…",
				},
			),
			"standalone",
		],
		[
			"PushNotification pending",
			call(
				"PushNotification",
				{},
				{
					pending: true,
				},
			),
			"standalone",
		],
		[
			"PushNotification isError",
			call(
				"PushNotification",
				{},
				{
					result: "Mobile push requested.",
					isError: true,
				},
			),
			"standalone",
		],
		["Bash", call("Bash"), "default"],
		["Agent", call("Agent"), "default"],
		["Edit", call("Edit"), "default"],
		["ToolSearch", call("ToolSearch"), "default"],
	];

	it("classifies calls exactly like upstream", () =>
	{
		expect(cases.map(([label, c]) => [label, toolBucket(c)])).toStrictEqual(
			cases.map(([label, , bucket]) => [label, bucket]),
		);
	});
});

describe("targetKey", () =>
{
	it("keys file tools by verb and path, folding MultiEdit into Edit", () =>
	{
		expect([
			targetKey(
				call(
					"Read",
					{
						file_path: "/a",
					},
				),
			),
			targetKey(
				call(
					"Write",
					{
						file_path: "/a",
					},
				),
			),
			targetKey(
				call(
					"Edit",
					{
						file_path: "/a",
					},
				),
			),
			targetKey(
				call(
					"MultiEdit",
					{
						file_path: "/a",
					},
				),
			),
			targetKey(
				call(
					"NotebookEdit",
					{
						notebook_path: "/n.ipynb",
					},
				),
			),
			targetKey(
				call(
					"NotebookEdit",
					{
						notebook_path: "/n.ipynb",
						edit_mode: "insert",
					},
				),
			),
			targetKey(call("Edit", {})),
			targetKey(
				call(
					"Bash",
					{
						command: "ls",
					},
				),
			),
		]).toStrictEqual([
			"Read /a",
			"Write /a",
			"Edit /a",
			"Edit /a",
			"NotebookEdit replace /n.ipynb",
			"NotebookEdit insert /n.ipynb",
			null,
			null,
		]);
	});
});

describe("rendersBare", () =>
{
	const editA = () =>
		call(
			"Edit",
			{
				file_path: "/a",
			},
		);
	const cases: [string, RunCall[], boolean][] = [
		["[Edit a]", [editA()], true],
		["[Edit a, Edit a]", [editA(), editA()], true],
		[
			"[MultiEdit a, Edit a]",
			[
				call(
					"MultiEdit",
					{
						file_path: "/a",
					},
				),
				editA(),
			],
			true,
		],
		[
			"[Read a, Edit a]",
			[
				call(
					"Read",
					{
						file_path: "/a",
					},
				),
				editA(),
			],
			false,
		],
		[
			"[Write a, Edit a]",
			[
				call(
					"Write",
					{
						file_path: "/a",
					},
				),
				editA(),
			],
			false,
		],
		[
			"[Edit a, Bash]",
			[
				editA(),
				call(
					"Bash",
					{
						command: "ls",
					},
				),
			],
			false,
		],
		["[]", [], false],
		[
			"[Edit a] with task events",
			[
				call(
					"Edit",
					{
						file_path: "/a",
					},
					{
						hasTaskEvents: true,
					},
				),
			],
			false,
		],
		[
			"[Edit a, Edit a] thinking after first",
			[
				editA(),
				call(
					"Edit",
					{
						file_path: "/a",
					},
					{
						precedingThinking: true,
					},
				),
			],
			false,
		],
		[
			"[Edit a] thinking before first",
			[
				call(
					"Edit",
					{
						file_path: "/a",
					},
					{
						precedingThinking: true,
					},
				),
			],
			true,
		],
		[
			"[NotebookEdit insert n, NotebookEdit replace n]",
			[
				call(
					"NotebookEdit",
					{
						notebook_path: "/n.ipynb",
						edit_mode: "insert",
					},
				),
				call(
					"NotebookEdit",
					{
						notebook_path: "/n.ipynb",
						edit_mode: "replace",
					},
				),
			],
			false,
		],
		[
			"[NotebookEdit replace n, NotebookEdit n]",
			[
				call(
					"NotebookEdit",
					{
						notebook_path: "/n.ipynb",
						edit_mode: "replace",
					},
				),
				call(
					"NotebookEdit",
					{
						notebook_path: "/n.ipynb",
					},
				),
			],
			true,
		],
	];

	it("is bare only when every call shares one file target", () =>
	{
		expect(
			cases.map(([label, calls]) => [
				label,
				rendersBare(
					calls,
					{
						showThinking: true,
					},
				),
			]),
		).toStrictEqual(cases.map(([label, , bare]) => [label, bare]));
	});

	it("ignores preceding thinking when thinking is hidden", () =>
	{
		expect(
			rendersBare(
				[
					editA(),
					call(
						"Edit",
						{
							file_path: "/a",
						},
						{
							precedingThinking: true,
						},
					),
				],
				{
					showThinking: false,
				},
			),
		).toStrictEqual(true);
	});
});

describe("splitRuns", () =>
{
	it("gives each standalone call its own run", () =>
	{
		const write = call(
			"Write",
			{
				file_path: "/a",
			},
		);
		const exit = call("ExitPlanMode");
		const edit = call(
			"Edit",
			{
				file_path: "/a",
			},
		);
		expect(splitRuns([write, exit, edit])).toStrictEqual([[write], [exit], [edit]]);
	});

	it("joins consecutive default calls", () =>
	{
		const edit = call(
			"Edit",
			{
				file_path: "/a",
			},
		);
		const bash = call(
			"Bash",
			{
				command: "ls",
			},
		);
		const grep = call(
			"Grep",
			{
				pattern: "x",
			},
		);
		expect(splitRuns([edit, bash, grep])).toStrictEqual([[edit, bash, grep]]);
	});

	it("never joins two standalone calls", () =>
	{
		const first = call("ExitPlanMode");
		const second = call("ExitPlanMode");
		expect(splitRuns([first, second])).toStrictEqual([[first], [second]]);
	});

	it("returns no runs for no calls", () =>
	{
		expect(splitRuns([])).toStrictEqual([]);
	});
});

describe("sameTarget", () =>
{
	it("is false for no calls", () =>
	{
		expect(sameTarget([])).toBe(false);
	});
	it("is true for one call, whatever its key", () =>
	{
		expect(sameTarget([call("Bash", {})])).toBe(true);
	});
	it("is true when Edit and MultiEdit touch one file", () =>
	{
		expect(
			sameTarget([
				call(
					"Edit",
					{
						file_path: "/a",
					},
				),
				call(
					"MultiEdit",
					{
						file_path: "/a",
					},
				),
			]),
		).toBe(true);
	});
	it("is false for two files", () =>
	{
		expect(
			sameTarget([
				call(
					"Edit",
					{
						file_path: "/a",
					},
				),
				call(
					"Edit",
					{
						file_path: "/b",
					},
				),
			]),
		).toBe(false);
	});
	it("is false for two keyless calls", () =>
	{
		expect(sameTarget([call("Bash", {}), call("Bash", {})])).toBe(false);
	});
});

describe("coalesceSameTarget", () =>
{
	it("folds a stretch of same-target calls into one run", () =>
	{
		const bash = call(
			"Bash",
			{
				command: "ls",
			},
		);
		const editA1 = call(
			"Edit",
			{
				file_path: "/a",
			},
		);
		const editA2 = call(
			"Edit",
			{
				file_path: "/a",
			},
		);
		const readB = call(
			"Read",
			{
				file_path: "/b",
			},
		);
		expect(coalesceSameTarget([bash, editA1, editA2, readB])).toStrictEqual([
			bash,
			{
				kind: "run",
				key: "Edit /a",
				members: [editA1, editA2],
			},
			readB,
		]);
	});
	it("keeps calls split by shown thinking apart", () =>
	{
		const first = call(
			"Edit",
			{
				file_path: "/a",
			},
		);
		const second = call(
			"Edit",
			{
				file_path: "/a",
			},
			{
				precedingThinking: true,
			},
		);
		expect(coalesceSameTarget([first, second])).toStrictEqual([first, second]);
	});
	it("splits after a call carrying task events", () =>
	{
		const first = call(
			"Edit",
			{
				file_path: "/a",
			},
			{
				hasTaskEvents: true,
			},
		);
		const second = call(
			"Edit",
			{
				file_path: "/a",
			},
		);
		expect(coalesceSameTarget([first, second])).toStrictEqual([first, second]);
	});
});

describe("runSuffix", () =>
{
	const read = (input: Record<string, unknown>, readFile?: RunSuffixCall["readFile"]): RunSuffixCall => (
	{
		name: "Read",
		input:
		{
			file_path: "/a",
			...input,
		},
		readFile,
	});
	const cases: [string, RunSuffixCall[], string | undefined][] = [
		[
			"two ranges",
			[
				read(
					{
						offset: 1,
						limit: 20,
					},
				),
				read(
					{
						offset: 40,
						limit: 21,
					},
				),
			],
			"(1–20, 40–60)",
		],
		[
			"a whole-file read drops the suffix",
			[
				read({}),
				read(
					{
						offset: 5,
					},
				),
			],
			undefined,
		],
		[
			"a one-line range stays a range",
			[
				read(
					{
						offset: 220,
						limit: 1,
					},
				),
			],
			"(220–220)",
		],
		[
			"an open-ended range",
			[
				read(
					{
						offset: 220,
					},
				),
			],
			"(220–)",
		],
		[
			"the lines the result reports",
			[
				read(
					{
						offset: 10,
						limit: 100,
					},
					{
						filePath: "/a",
						startLine: 10,
						numLines: 3,
						endsWithNewline: false,
					},
				),
			],
			"(10–12)",
		],
		[
			"a read to the end of a file ending in a newline",
			[
				read(
					{
						offset: 1,
						limit: 2000,
					},
					{
						filePath: "/a",
						startLine: 1,
						numLines: 45,
						totalLines: 45,
						endsWithNewline: true,
					},
				),
			],
			"(1–44)",
		],
		[
			"a read to the end of a file with no final newline",
			[
				read(
					{
						offset: 1,
						limit: 2000,
					},
					{
						filePath: "/a",
						startLine: 1,
						numLines: 45,
						totalLines: 45,
						endsWithNewline: false,
					},
				),
			],
			"(1–45)",
		],
		[
			"a one-line file ending in a newline",
			[
				read(
					{
						offset: 1,
					},
					{
						filePath: "/a",
						startLine: 1,
						numLines: 1,
						totalLines: 1,
						endsWithNewline: true,
					},
				),
			],
			"(1–1)",
		],
		[
			"a start line of 0 clamps to 1",
			[
				read(
					{
						offset: 1,
					},
					{
						filePath: "/a",
						startLine: 0,
						numLines: 3,
						endsWithNewline: false,
					},
				),
			],
			"(1–3)",
		],
		[
			"a result for another file falls back to the input",
			[
				read(
					{
						offset: 5,
						limit: 2,
					},
					{
						filePath: "/b",
						startLine: 1,
						numLines: 3,
						endsWithNewline: false,
					},
				),
			],
			"(5–6)",
		],
		[
			"three notebook inserts",
			Array.from(
				{
					length: 3,
				},
				() => (
				{
					name: "NotebookEdit",
					input:
					{
						notebook_path: "/n",
						edit_mode: "insert",
					},
				}),
			),
			"×3",
		],
		[
			"two notebook replaces",
			Array.from(
				{
					length: 2,
				},
				() => (
				{
					name: "NotebookEdit",
					input:
					{
						notebook_path: "/n",
						edit_mode: "replace",
					},
				}),
			),
			undefined,
		],
		[
			"one notebook insert",
			[
				{
					name: "NotebookEdit",
					input:
					{
						notebook_path: "/n",
						edit_mode: "insert",
					},
				},
			],
			undefined,
		],
		[
			"edits",
			[
				{
					name: "Edit",
					input:
					{
						file_path: "/a",
					},
				},
			],
			undefined,
		],
	];
	it.each(cases)("%s", (_, calls, expected) =>
	{
		expect(runSuffix(calls)).toBe(expected);
	});
});
