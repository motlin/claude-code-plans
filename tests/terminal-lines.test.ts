import {describe, expect, it} from "vite-plus/test";
import type {ToolResultInfo} from "../src/lib/sessions";
import {buildTerminalLines, terminalToolResult} from "../src/lib/terminal-lines";
import type {SessionContentBlock, SessionLine} from "../src/lib/transcript";

function user(uuid: string, content: string | SessionContentBlock[], extra: Partial<SessionLine> = {}): SessionLine
{
	return {
		type: "user",
		uuid,
		lineIndex: 0,
		message:
		{
			role: "user",
			content,
		},
		...extra,
	} as SessionLine;
}

function assistant(uuid: string, content: SessionContentBlock[]): SessionLine
{
	return {
		type: "assistant",
		uuid,
		lineIndex: 1,
		message:
		{
			role: "assistant",
			content,
		},
	};
}

function tool(id: string, name: string, input: Record<string, unknown>): SessionLine
{
	return assistant(`a-${id}`, [
		{
			type: "tool_use",
			id,
			name,
			input: input,
		},
	]);
}

function result(partial: Partial<ToolResultInfo>): ToolResultInfo
{
	return {
		result: "",
		isError: false,
		resultUuid: "r",
		...partial,
	};
}

describe("buildTerminalLines", () =>
{
	it("draws prompts, assistant text and thinking, dropping blank text and meta prompts", () =>
	{
		expect(
			buildTerminalLines(
				[
					user("u1", "fix the bug"),
					user(
						"meta",
						"caveat",
						{
							isMeta: true,
						},
					),
					assistant("a1", [
						{
							type: "thinking",
							thinking: "hmm",
						},
						{
							type: "text",
							text: "   ",
						},
						{
							type: "text",
							text: "Done.",
						},
					]),
				],
				new Map(),
			),
		).toStrictEqual([
			{
				kind: "prompt",
				id: "u1:0",
				text: "fix the bug",
			},
			{
				kind: "thinking",
				id: "a1:0",
				text: "hmm",
			},
			{
				kind: "assistant",
				id: "a1:2",
				text: "Done.",
			},
		]);
	});

	it("turns compaction, images and API errors into event and error lines", () =>
	{
		expect(
			buildTerminalLines(
				[
					{
						type: "system",
						subtype: "compact_boundary",
						lineIndex: 4,
					},
					user("u2", [
						{
							type: "image",
							source:
							{
								type: "base64",
								media_type: "image/png",
								data: "",
							},
						},
					]),
					{
						type: "assistant",
						uuid: "err",
						lineIndex: 6,
						isApiErrorMessage: true,
						message:
						{
							content: [
								{
									type: "text",
									text: "API Error: 529 overloaded",
								},
							],
						},
					},
				],
				new Map(),
			),
		).toStrictEqual([
			{
				kind: "event",
				id: "#4",
				label:
				{
					kind: "item",
					itemKind: "compacted",
				},
			},
			{
				kind: "event",
				id: "u2:0",
				label:
				{
					kind: "item",
					itemKind: "image",
				},
			},
			{
				kind: "error",
				id: "err",
				text: "API Error: 529 overloaded",
			},
		]);
	});

	it("names MCP tools srv:tool (MCP), reads the arg by priority and truncates it at 96", () =>
	{
		const long = "x".repeat(120);
		const lines = buildTerminalLines(
			[
				tool(
					"t1",
					"mcp__github__get_issue",
					{
						number: 3,
					},
				),
				tool(
					"t2",
					"Bash",
					{
						description: "d",
						command: "c",
					},
				),
				tool(
					"t3",
					"Bash",
					{
						command: long,
					},
				),
			],
			new Map(),
		);
		expect(
			lines.map((line) => (line.kind === "tool" ? [line.name, line.arg, line.status] : line.kind)),
		).toStrictEqual([
			["github:get_issue (MCP)", undefined, "running"],
			["Bash", "c", "running"],
			["Bash", `${"x".repeat(95)}…`, "running"],
		]);
	});

	it("draws a chapter call as a ── chapter line and a todo call as a todo list", () =>
	{
		expect(
			buildTerminalLines(
				[
					tool(
						"c1",
						"mcp__ccd_session__mark_chapter",
						{
							title: " Setup ",
						},
					),
					tool(
						"todo",
						"TodoWrite",
						{
							todos: [
								{
									content: "x",
									status: "completed",
								},
								{
									content: "y",
									status: "in_progress",
								},
							],
						},
					),
				],
				new Map(),
			),
		).toStrictEqual([
			{
				kind: "chapter",
				id: "c1",
				title: "Setup",
			},
			{
				kind: "todos",
				id: "todo",
				items: [
					{
						id: "todo-0",
						content: "x",
						status: "completed",
					},
					{
						id: "todo-1",
						content: "y",
						status: "in_progress",
					},
				],
			},
		]);
	});

	it("marks interrupted and rejected results apart from errors", () =>
	{
		const lines = buildTerminalLines(
			[
				tool(
					"i",
					"Read",
					{
						file_path: "/a",
					},
				),
				tool(
					"r",
					"Edit",
					{
						file_path: "/b",
					},
				),
				tool(
					"e",
					"Bash",
					{
						command: "x",
					},
				),
			],
			new Map([
				[
					"i",
					result(
						{
							isError: true,
							interrupted: true,
							stopped: true,
							result: "Interrupted",
						},
					),
				],
				[
					"r",
					result(
						{
							isError: true,
							denied: true,
							stopped: true,
							result: "no",
						},
					),
				],
				[
					"e",
					result(
						{
							isError: true,
							result: "boom",
						},
					),
				],
			]),
		);
		expect(
			lines.map((line) =>
				line.kind === "tool" ? [line.status, line.interrupted, line.rejected, line.isError] : line.kind,
			),
		).toStrictEqual([
			["error", true, false, false],
			["error", false, true, true],
			["error", false, false, true],
		]);
	});

	it("pairs a ! shell input with its output record as a Bash row", () =>
	{
		expect(
			buildTerminalLines(
				[
					user("b1", "<bash-input>ls</bash-input>"),
					user("b2", "<bash-stdout>a\nb</bash-stdout><bash-stderr></bash-stderr>"),
				],
				new Map(),
			),
		).toStrictEqual([
			{
				kind: "tool",
				id: "b1:0",
				name: "Bash",
				arg: "ls",
				status: "completed",
				interrupted: false,
				rejected: false,
				isError: false,
				resultSummary: "a",
				resultExtraLineCount: 1,
				resultFullText: "a\nb",
			},
		]);
	});
});

describe("terminalToolResult", () =>
{
	it("strips ANSI and summarizes from the first non-blank line", () =>
	{
		expect(terminalToolResult("\n\u001B[31mfirst\u001B[0m\nsecond\nthird")).toStrictEqual(
			{
				resultSummary: "first",
				resultExtraLineCount: 2,
				resultFullText: "first\nsecond\nthird",
			},
		);
	});

	it("caps a long single line at 200 and keeps the full text", () =>
	{
		const line = "y".repeat(250);
		expect(terminalToolResult(line)).toStrictEqual(
			{
				resultSummary: `${"y".repeat(199)}…`,
				resultExtraLineCount: 0,
				resultFullText: line,
			},
		);
	});

	it("has no summary for empty or blank output", () =>
	{
		expect([terminalToolResult(undefined), terminalToolResult(" \n ")]).toStrictEqual([
			{
				resultSummary: undefined,
				resultExtraLineCount: 0,
				resultFullText: undefined,
			},
			{
				resultSummary: undefined,
				resultExtraLineCount: 0,
				resultFullText: undefined,
			},
		]);
	});
});
