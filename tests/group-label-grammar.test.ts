import
{
	countedLabelText,
	shapeSegmentsForTest,
	splitTrailingFile,
	summarizeToolCallStats,
	type BackgroundCompletionLike,
	type ToolCallLike,
} from "../src/lib/session-utils";

/** The group header text, joined the way upstream draws it: "Ran 2 commands, edited a.ts". */
function label(calls: ToolCallLike[]): string
{
	return countedLabelText(summarizeToolCallStats(calls));
}

const bash = (extra: Partial<ToolCallLike> = {}): ToolCallLike => (
{
	name: "Bash",
	input:
	{
		command: "ls",
	},
	...extra,
});

describe("group label: memory files", () =>
{
	it("names a memory file like any other file, as upstream has no memory segment for Read or Write", () =>
	{
		expect(
			{
				write: label([
					{
						name: "Write",
						input:
						{
							file_path: "/Users/me/.claude/projects/-x/memory/little-snitch-network-blocks.md",
						},
					},
					bash(),
				]),
				read: label([
					{
						name: "Read",
						input:
						{
							file_path: "/Users/me/.claude/memory/MEMORY.md",
						},
					},
					bash(),
				]),
			},
		).toStrictEqual(
			{
				write: "Created little-snitch-network-blocks.md, ran a command",
				read: "Read MEMORY.md, ran a command",
			},
		);
	});
});

describe("group label: tool categories", () =>
{
	const tool = (name: string, input: Record<string, unknown> = {}): ToolCallLike => (
	{
		name,
		input,
	});

	it.each([
		{
			calls: [tool("Skill"), bash(), bash(), bash()],
			expected: "Ran 3 commands, ran skill",
		},
		{
			calls: [tool("Skill"), tool("ToolSearch")],
			expected: "Ran skill, loaded tools",
		},
		{
			calls: [tool("mcp__a__x"), tool("mcp__a__x"), tool("mcp__plugin_b_b__y")],
			expected: "Used a 2 times, used b",
		},
		{
			calls: [
				tool(
					"mcp__claude_ai_Claude_Docs__read",
					{
						container:
						{
							kind: "project",
							id: "doc-1",
						},
					},
				),
				tool(
					"mcp__claude_ai_Claude_Docs__update",
					{
						container:
						{
							kind: "project",
							id: "doc-1",
						},
					},
				),
				tool(
					"mcp__claude_ai_Claude_Docs__read",
					{
						container:
						{
							kind: "project",
							id: "doc-1",
						},
					},
				),
			],
			expected: "Read 2 files, used claude_ai_Claude_Docs",
		},
		{
			calls: [
				tool("TaskCreate"),
				tool("EnterPlanMode"),
				tool("SendMessage"),
				tool("Artifact"),
				tool("CronCreate"),
			],
			expected: "Added task, started planning, messaged another session, and 2 more actions",
		},
		{
			calls: [
				...Array.from(
					{
						length: 7,
					},
					() => tool("TaskStop"),
				),
				bash(),
			],
			expected: "Ran a command, stopped task 7 times",
		},
		{
			calls: [
				tool("ToolSearch"),
				{
					...tool("ToolSearch"),
					stopped: true,
				},
			],
			expected: "Loaded tools 2 times (1 stopped)",
		},
		{
			calls: [
				{
					...tool("ToolSearch"),
					isError: true,
				},
				bash(),
			],
			expected: "Ran a command, loading tools, 1 failed",
		},
		{
			calls: [tool("Skill"), bash(), tool("Grep"), tool("ToolSearch"), tool("TaskStop")],
			expected: "Ran a command, searched code, ran skill, and 2 more actions",
		},
		{
			calls: [tool("ToolSearch"), tool("TaskCreate"), bash(), tool("Skill")],
			expected: "Ran a command, loaded tools, added task, ran skill",
		},
		{
			calls: [tool("WebSearch"), tool("WebSearch"), tool("WebFetch")],
			expected: "Browsed the web, fetched a page",
		},
		{
			calls: [tool("TodoWrite"), tool("TodoWrite"), bash()],
			expected: "Updated todos, ran a command",
		},
		{
			calls: [tool("Grep"), tool("Grep"), tool("Glob")],
			expected: "Searched code, found files",
		},
		{
			calls: [tool("ExitPlanMode"), tool("Agent"), tool("Task")],
			expected: "Proposed a plan, ran 2 agents",
		},
		{
			calls: [
				{
					...tool("PushNotification"),
					result: "Notification sent",
				},
				bash(),
			],
			expected: "Sent a notification, ran a command",
		},
		{
			calls: [
				tool(
					"Artifact",
					{
						action: "read",
						url: "https://claude.ai/artifact/a",
					},
				),
				tool(
					"Artifact",
					{
						action: "read_db",
						url: "https://claude.ai/artifact/b",
					},
				),
				tool(
					"Artifact",
					{
						action: "read",
						url: "https://claude.ai/artifact/a",
					},
				),
			],
			expected: "Read 2 artifacts",
		},
		{
			calls: [
				tool(
					"Artifact",
					{
						action: "read",
						url: "https://claude.ai/artifact/a",
					},
				),
				tool(
					"Artifact",
					{
						action: "write_db",
						url: "https://claude.ai/artifact/a",
					},
				),
				tool("Artifact"),
			],
			expected: "Updated an artifact, published artifact",
		},
		{
			calls: [
				tool(
					"EnterWorktree",
					{
						path: "/repo/.worktrees/a",
					},
				),
				bash(),
				tool(
					"ExitWorktree",
					{
						action: "keep",
					},
				),
			],
			expected: "Moved to a worktree, ran a command, left the worktree",
		},
		{
			calls: [
				{
					...tool(
						"EnterWorktree",
						{
							name: "a",
						},
					),
					isError: true,
				},
				bash(),
			],
			expected: "Ran a command, creating a worktree, 1 failed",
		},
		{
			calls: [tool("PowerShell"), bash()],
			expected: "Ran 2 commands",
		},
		{
			calls: [
				tool(
					"NotebookEdit",
					{
						notebook_path: "/a.ipynb",
					},
				),
				tool(
					"NotebookEdit",
					{
						notebook_path: "/b.ipynb",
					},
				),
			],
			expected: "Edited 2 notebooks",
		},
	])("labels $expected, naming each uncategorized tool by its group words", ({calls, expected}) =>
	{
		expect(label(calls)).toBe(expected);
	});
});

const edit = (filePath: string, extra: Partial<ToolCallLike> = {}): ToolCallLike => (
{
	name: "Edit",
	input:
	{
		file_path: filePath,
		old_string: "a",
		new_string: "b",
	},
	...extra,
});
const read = (filePath: string, extra: Partial<ToolCallLike> = {}): ToolCallLike => (
{
	name: "Read",
	input:
	{
		file_path: filePath,
	},
	...extra,
});

describe("group label: distinct files", () =>
{
	it.each([
		{
			calls: [
				edit(
					"/r/a.ts",
					{
						isError: true,
					},
				),
				edit("/r/a.ts"),
			],
			expected: "Edited a.ts",
		},
		{
			calls: [
				edit("/r/a.ts"),
				edit(
					"/r/a.ts",
					{
						isError: true,
					},
				),
			],
			expected: "Edited a.ts (1 failed)",
		},
		{
			calls: [edit("/r/a.ts"), edit("/r/b.ts"), edit("/r/a.ts")],
			expected: "Edited 2 files",
		},
		{
			calls: [bash(), edit("/r/x"), edit("/r/x"), bash()],
			expected: "Ran 2 commands, edited x",
		},
		{
			calls: [
				bash(
					{
						id: "b1",
						isError: true,
					},
				),
				bash(
					{
						id: "b2",
					},
				),
			],
			expected: "Ran 2 commands (1 failed)",
		},
		{
			calls: [
				edit(
					"/r/a.ts",
					{
						isError: true,
					},
				),
				read("/r/b.ts"),
				read("/r/c.ts"),
				bash(),
				edit("/r/a.ts"),
				edit("/r/d.ts"),
			],
			expected: "Edited 2 files, read 2 files, ran a command",
		},
	])("counts each file once, at its last call's status: $expected", ({calls, expected}) =>
	{
		expect(label(calls)).toBe(expected);
	});
});

describe("group label: failure count", () =>
{
	const mcp = (extra: Partial<ToolCallLike> = {}): ToolCallLike => (
	{
		name: "mcp__x__y",
		input: {},
		...extra,
	});

	it.each([
		{
			calls: [
				edit(
					"/r/k.ts",
					{
						isError: true,
					},
				),
				bash(),
			],
			expected: "Tried to edit k.ts, ran a command, 1 failed",
		},
		{
			calls: [
				read(
					"/r/a",
					{
						isError: true,
					},
				),
				bash(),
				read("/r/b"),
				read("/r/c"),
				read("/r/d"),
				bash(),
			],
			expected: "Read 4 files, ran 2 commands, 1 failed",
		},
		{
			calls: [
				bash(
					{
						isError: true,
					},
				),
				read(
					"/r/a",
					{
						isError: true,
					},
				),
				read(
					"/r/b",
					{
						isError: true,
					},
				),
				read(
					"/r/c",
					{
						isError: true,
					},
				),
			],
			expected: "Ran a command, tried to read 3 files, 4 failed",
		},
		{
			calls: [
				mcp(
					{
						isError: true,
					},
				),
				bash(),
				mcp(),
			],
			expected: "Ran a command, used x 2 times, 1 failed",
		},
		{
			calls: [
				bash(
					{
						isError: true,
					},
				),
				bash(),
			],
			expected: "Ran 2 commands (1 failed)",
		},
	])(
		"totals every failure in one trailing outcomes part, or inline on a lone segment: $expected",
		({calls, expected}) =>
		{
			expect(label(calls)).toBe(expected);
		},
	);
});

describe("group label: rejected and interrupted calls", () =>
{
	const tool = (name: string, extra: Partial<ToolCallLike> = {}): ToolCallLike => (
	{
		name,
		input: {},
		...extra,
	});
	const write = (filePath: string, extra: Partial<ToolCallLike> = {}): ToolCallLike => (
	{
		name: "Write",
		input:
		{
			file_path: filePath,
			content: "x",
		},
		...extra,
	});

	it.each([
		{
			calls: [
				bash(),
				bash(),
				bash(
					{
						isError: true,
						stopped: true,
					},
				),
			],
			expected: "Ran 3 commands (1 stopped)",
		},
		{
			calls: [
				bash(
					{
						isError: true,
						denied: true,
					},
				),
				bash(),
			],
			expected: "Ran 2 commands (1 stopped)",
		},
		{
			calls: [
				{
					name: "mcp__x__y",
					input: {},
					isError: true,
					stopped: true,
				},
			],
			expected: "Using x (1 stopped)",
		},
		{
			calls: [
				edit("/r/a.ts"),
				edit(
					"/r/a.ts",
					{
						isError: true,
						stopped: true,
					},
				),
			],
			expected: "Edited a.ts",
		},
		{
			calls: [
				edit(
					"/r/a.ts",
					{
						isError: true,
					},
				),
				edit(
					"/r/a.ts",
					{
						isError: true,
						denied: true,
					},
				),
			],
			expected: "Tried to edit a.ts (1 failed)",
		},
		{
			calls: [
				edit("/r/a.ts"),
				edit(
					"/r/b.ts",
					{
						isError: true,
						stopped: true,
					},
				),
			],
			expected: "Edited 2 files (1 stopped)",
		},
		{
			calls: [
				bash(
					{
						id: "b1",
					},
				),
				read("/d/CLAUDE.md"),
				edit(
					"/d/CLAUDE.md",
					{
						isError: true,
						stopped: true,
					},
				),
				write(
					"/m/x.md",
					{
						isError: true,
						stopped: true,
					},
				),
				bash(
					{
						id: "b2",
						isError: true,
						stopped: true,
					},
				),
			],
			expected:
				"Ran 2 commands (1 stopped), read a file, tried to edit a file (1 stopped), tried to write a file (1 stopped)",
		},
		{
			calls: [
				bash(),
				tool("Grep"),
				tool("Glob"),
				tool(
					"WebSearch",
					{
						isError: true,
						stopped: true,
					},
				),
				tool("WebFetch"),
			],
			expected: "Ran a command, searched code, found files, and 2 more actions",
		},
	])("adds an inline stopped count to the segment: $expected", ({calls, expected}) =>
	{
		expect(label(calls)).toBe(expected);
	});
});

describe("group label: failed and stopped in one segment", () =>
{
	it.each([
		{
			calls: [
				bash(
					{
						id: "b1",
					},
				),
				bash(
					{
						id: "b2",
						isError: true,
					},
				),
				bash(
					{
						id: "b3",
						isError: true,
						stopped: true,
					},
				),
			],
			expected: "Ran 3 commands (1 failed, 1 stopped)",
		},
		{
			calls: [
				bash(
					{
						id: "b1",
						isError: true,
					},
				),
				bash(
					{
						id: "b2",
						isError: true,
						stopped: true,
					},
				),
				read("/r/a.ts"),
			],
			expected: "Ran 2 commands (1 stopped), read a.ts, 1 failed",
		},
	])("keeps both inline on a lone segment, else trails the failures: $expected", ({calls, expected}) =>
	{
		expect(label(calls)).toBe(expected);
	});
});

describe("group label: auto-mode blocked calls", () =>
{
	const blocked =
	{
		isError: true,
		blocked: true,
	} as const;

	it.each([
		{
			calls: [
				bash(
					{
						id: "1",
					},
				),
				bash(
					{
						id: "2",
					},
				),
				bash(
					{
						id: "3",
					},
				),
				bash(
					{
						id: "4",
					},
				),
				bash(
					{
						id: "5",
					},
				),
				bash(
					{
						id: "6",
						...blocked,
					},
				),
			],
			expected: "Ran 6 commands (1 blocked)",
		},
		{
			calls: [
				bash(
					{
						id: "1",
						isError: true,
					},
				),
				bash(
					{
						id: "2",
						...blocked,
					},
				),
				bash(
					{
						id: "3",
					},
				),
			],
			expected: "Ran 3 commands (1 failed, 1 blocked)",
		},
		{
			calls: [
				bash(
					{
						id: "1",
						...blocked,
					},
				),
				bash(
					{
						id: "2",
						isError: true,
						stopped: true,
					},
				),
				bash(
					{
						id: "3",
					},
				),
			],
			expected: "Ran 3 commands (1 blocked)",
		},
		{
			calls: [
				bash(
					{
						id: "1",
						...blocked,
					},
				),
				read("/r/a.ts"),
			],
			expected: "Tried to run a command, read a.ts, 1 blocked",
		},
		{
			calls: [
				bash(
					{
						id: "1",
						...blocked,
					},
				),
				bash(
					{
						id: "2",
					},
				),
				read(
					"/r/a.ts",
					{
						isError: true,
					},
				),
			],
			expected: "Ran 2 commands, tried to read a.ts, 1 failed, 1 blocked",
		},
		{
			calls: [
				edit(
					"/r/a.ts",
					{
						isError: true,
					},
				),
				edit("/r/a.ts", blocked),
			],
			expected: "Tried to edit a.ts (1 blocked)",
		},
	])("counts the block instead of a failure: $expected", ({calls, expected}) =>
	{
		expect(label(calls)).toBe(expected);
	});
});

describe("group label: segments whose calls never ran", () =>
{
	const blocked =
	{
		isError: true,
		blocked: true,
	} as const;

	it.each([
		{
			calls: [
				bash(
					{
						id: "1",
						...blocked,
					},
				),
				bash(
					{
						id: "2",
						...blocked,
					},
				),
			],
			expected: "Tried to run 2 commands (2 blocked)",
		},
		{
			calls: [
				{
					name: "Write",
					input:
					{
						file_path: "/r/c.ts",
						content: "x",
					},
				},
				bash(
					{
						id: "1",
					},
				),
				bash(
					{
						id: "2",
					},
				),
				edit(
					"/r/a.ts",
					{
						isError: true,
					},
				),
				edit(
					"/r/b.ts",
					{
						isError: true,
					},
				),
			],
			expected: "Created a file, ran 2 commands, tried to edit 2 files, 2 failed",
		},
		{
			calls: [
				bash(
					{
						id: "1",
						isError: true,
					},
				),
				bash(
					{
						id: "2",
					},
				),
			],
			expected: "Ran 2 commands (1 failed)",
		},
		{
			calls: [
				bash(
					{
						isError: true,
						stopped: true,
					},
				),
			],
			expected: "Ran a command (1 stopped)",
		},
		{
			calls: [
				bash(
					{
						isError: true,
						stopped: true,
						neverRan: true,
					},
				),
			],
			expected: "Tried to run a command (1 stopped)",
		},
		{
			calls: [
				edit(
					"/r/x.ts",
					{
						isError: true,
						stopped: true,
					},
				),
				read("/r/x.ts"),
			],
			expected: "Read and tried to edit x.ts (1 stopped)",
		},
	])("swaps in upstream's 'tried to' verb: $expected", ({calls, expected}) =>
	{
		expect(label(calls)).toBe(expected);
	});
});

describe("group label: one file", () =>
{
	const write = (filePath: string, writeType?: "create" | "update"): ToolCallLike =>
		writeType === undefined
			?
				{
					name: "Write",
					input:
					{
						file_path: filePath,
						content: "x",
					},
				}
			:
				{
					name: "Write",
					input:
					{
						file_path: filePath,
						content: "x",
					},
					resultMeta:
					{
						writeType,
					},
				};
	const notebook = (path: string): ToolCallLike => (
	{
		name: "NotebookEdit",
		input:
		{
			notebook_path: path,
		},
	});

	it.each([
		{
			calls: [read("/r/x.ts"), edit("/r/y.ts")],
			expected: "Read a file, edited a file",
		},
		{
			calls: [read("/r/x.ts"), edit("/r/x.ts")],
			expected: "Read and edited x.ts",
		},
		{
			calls: [edit("/r/x.ts"), read("/r/x.ts")],
			expected: "Edited and read x.ts",
		},
		{
			calls: [write("/r/x.ts", "create"), edit("/r/x.ts")],
			expected: "Created and edited x.ts",
		},
		{
			calls: [write("/r/x.ts", "update"), bash()],
			expected: "Edited x.ts, ran a command",
		},
		{
			calls: [
				{
					...write("/r/x.ts"),
					isError: true,
				},
				bash(),
				read("/r/x.ts"),
				write("/r/x.ts", "update"),
			],
			expected: "Edited and read x.ts, ran a command",
		},
		{
			calls: [read("/r/x.ts"), edit("/r/x.ts"), write("/r/x.ts", "create")],
			expected: "Read, edited, and created x.ts",
		},
		{
			calls: [bash(), write("/r/a.md", "create"), edit("/r/b.md")],
			expected: "Ran a command, created a file, edited a file",
		},
		{
			calls: [read("/r/x.ts"), read("/r/x.ts")],
			expected: "Read x.ts",
		},
		{
			calls: [
				read("/r/x.ts"),
				{
					name: "Read",
					input: {},
				},
			],
			expected: "Read 2 files",
		},
		{
			calls: [notebook("/r/n.ipynb"), read("/r/n.ipynb")],
			expected: "Edited and read n.ipynb",
		},
		{
			calls: [
				edit(
					"/r/A.java",
					{
						isError: true,
					},
				),
				bash(),
				read("/r/A.java"),
				edit("/r/A.java"),
				bash(),
			],
			expected: "Edited and read A.java, ran 2 commands",
		},
		{
			calls: [
				read(
					"/r/x.ts",
					{
						isError: true,
					},
				),
				edit(
					"/r/x.ts",
					{
						isError: true,
					},
				),
			],
			expected: "Tried to read and tried to edit x.ts (2 failed)",
		},
		{
			calls: [
				read("/r/x.ts"),
				edit(
					"/r/x.ts",
					{
						isError: true,
						stopped: true,
					},
				),
			],
			expected: "Read and tried to edit x.ts (1 stopped)",
		},
		{
			calls: [
				read(
					"/r/x.ts",
					{
						isError: true,
					},
				),
				edit(
					"/r/x.ts",
					{
						isError: true,
						stopped: true,
					},
				),
			],
			expected: "Tried to read and tried to edit x.ts (1 failed, 1 stopped)",
		},
		{
			calls: [
				read(
					"/r/x.ts",
					{
						isError: true,
					},
				),
				edit(
					"/r/x.ts",
					{
						isError: true,
						stopped: true,
					},
				),
				bash(),
			],
			expected: "Tried to read and tried to edit x.ts (1 stopped), ran a command, 1 failed",
		},
	])("names the file only when the whole group touches just it: $expected", ({calls, expected}) =>
	{
		expect(label(calls)).toBe(expected);
	});
});

describe("group label: trailing file meta", () =>
{
	const split = (calls: ToolCallLike[]) => splitTrailingFile(summarizeToolCallStats(calls).segments);
	const stopped =
	{
		isError: true,
		stopped: true,
	};

	it("splits the trailing sole file off the phrases, as upstream's j() moves it to the meta slot", () =>
	{
		expect(
			{
				afterCommands: split([bash(), bash(), read("/r/a.png")]),
				alone: split([read("/r/x.ts"), edit("/r/x.ts")]),
				retried: split([
					edit(
						"/r/x.ts",
						{
							isError: true,
						},
					),
					edit("/r/x.ts"),
				]),
				multiEdit: split([
					{
						name: "MultiEdit",
						input:
						{
							file_path: "/r/x.ts",
							edits: [],
						},
					},
				]),
			},
		).toStrictEqual(
			{
				afterCommands:
				{
					segments: [
						{
							verb: "Ran",
							rest: "2 commands",
						},
						{
							verb: "read",
							rest: "",
						},
					],
					name: "a.png",
					file:
					{
						path: "/r/a.png",
						preferDiff: false,
					},
				},
				alone:
				{
					segments: [
						{
							verb: "Read and edited",
							rest: "",
						},
					],
					name: "x.ts",
					file:
					{
						path: "/r/x.ts",
						preferDiff: true,
					},
				},
				retried:
				{
					segments: [
						{
							verb: "Edited",
							rest: "",
						},
					],
					name: "x.ts",
					file:
					{
						path: "/r/x.ts",
						preferDiff: true,
					},
				},
				multiEdit:
				{
					segments: [
						{
							verb: "Edited",
							rest: "",
						},
					],
					name: "x.ts",
					file:
					{
						path: "/r/x.ts",
						preferDiff: true,
					},
				},
			},
		);
	});

	it.each([
		{
			name: "the file segment is not last",
			calls: [read("/r/x.ts"), bash()],
		},
		{
			name: "a call on it failed",
			calls: [
				edit(
					"/r/x.ts",
					{
						isError: true,
					},
				),
			],
		},
		{
			name: "its meta carries a stop note",
			calls: [read("/r/x.ts"), edit("/r/x.ts", stopped)],
		},
		{
			name: "its meta carries a block note",
			calls: [
				edit(
					"/r/x.ts",
					{
						blocked: true,
					},
				),
			],
		},
		{
			name: "the group trails a failure",
			calls: [
				bash(
					{
						isError: true,
					},
				),
				read("/r/x.ts"),
			],
		},
		{
			name: "the path holds an invisible character",
			calls: [read("/r/a\u200b.png")],
		},
		{
			name: "the path holds a control character",
			calls: [read("/r/a\u0007.png")],
		},
		{
			name: "a file call is not Read/Write/Edit/MultiEdit/NotebookEdit",
			calls: [
				read("/r/x.ts"),
				{
					name: "mcp__fs__read",
					input:
					{
						file_path: "/r/x.ts",
					},
				},
			],
		},
		{
			name: "the header folds into and N more actions",
			calls: [
				{
					name: "Grep",
					input: {},
				},
				{
					name: "Glob",
					input: {},
				},
				bash(),
				{
					name: "WebFetch",
					input: {},
				},
				read("/r/x.ts"),
			],
		},
	])("keeps the name in the phrases when $name", ({calls}) =>
	{
		expect(split(calls)).toBeUndefined();
	});

	it("leaves the unsplit header text as is", () =>
	{
		expect(label([read("/r/x.ts"), edit("/r/x.ts")])).toBe("Read and edited x.ts");
	});
});

describe("group label: cap", () =>
{
	const tool = (name: string, extra: Partial<ToolCallLike> = {}): ToolCallLike => (
	{
		name,
		input: {},
		...extra,
	});

	it.each([
		{
			calls: [
				tool("ToolSearch"),
				bash(),
				tool("WebSearch"),
				tool("WebSearch"),
				tool("WebSearch"),
				tool("WebFetch"),
				tool("WebFetch"),
				tool("WebFetch"),
				tool("WebSearch"),
				tool("WebFetch"),
				edit("/r/w.md"),
			],
			expected: "Ran a command, browsed the web, fetched 4 pages, and 2 more actions",
		},
		{
			calls: [
				bash(),
				bash(),
				bash(),
				bash(),
				{
					...tool("Write"),
					input:
					{
						file_path: "/r/a",
					},
				},
				read("/r/b"),
				edit("/r/c"),
			],
			expected: "Ran 4 commands, created a file, read a file, edited a file",
		},
		{
			calls: [
				bash(),
				tool("Grep"),
				tool("Glob"),
				tool("WebSearch"),
				tool(
					"mcp__x__y",
					{
						isError: true,
					},
				),
			],
			expected: "Ran a command, searched code, found files, and 2 more actions, 1 failed",
		},
	])("keeps the first three of five or more segments: $expected", ({calls, expected}) =>
	{
		expect(label(calls)).toBe(expected);
	});

	it("counts background completions among the dropped actions, folded into the trailing part", () =>
	{
		const {segments, trailing} = summarizeToolCallStats(
			[bash(), tool("Grep"), tool("Glob"), tool("WebSearch")],
			[
				{
					command: true,
					status: "completed",
				},
				{
					command: true,
					status: "completed",
				},
			],
		);

		expect(
			{
				segments,
				trailing,
			},
		).toStrictEqual(
			{
				segments: [
					{
						verb: "Ran",
						rest: "a command",
					},
					{
						verb: "searched",
						rest: "code",
					},
					{
						verb: "found",
						rest: "files,",
					},
				],
				trailing: " and 3 more actions",
			},
		);
	});

	it("totals failures and blocks over every segment, folded ones too, after the fold", () =>
	{
		expect(
			label([
				bash(
					{
						isError: true,
						blocked: true,
					},
				),
				tool("Grep"),
				tool("Glob"),
				tool("WebSearch"),
				tool(
					"mcp__x__y",
					{
						isError: true,
					},
				),
			]),
		).toBe("Tried to run a command, searched code, found files, and 2 more actions, 1 failed, 1 blocked");
	});
});

describe("group label: received messages", () =>
{
	const received = (
		calls: ToolCallLike[],
		messages:
		{
			leading: number;
			trailing: number;
		},
		completions: BackgroundCompletionLike[] = [],
	): string => countedLabelText(summarizeToolCallStats(calls, completions, new Set(), messages));
	const failedTask: BackgroundCompletionLike =
	{
		status: "failed",
		command: false,
		toolUseId: null,
	};
	const finishedCommand: BackgroundCompletionLike =
	{
		status: "completed",
		command: true,
		toolUseId: null,
	};

	it.each([
		{
			calls: [bash()],
			messages:
			{
				leading: 1,
				trailing: 0,
			},
			expected: "Received a message, ran a command",
		},
		{
			calls: [bash()],
			messages:
			{
				leading: 2,
				trailing: 0,
			},
			expected: "Received 2 messages, ran a command",
		},
		{
			calls: [bash(), bash()],
			messages:
			{
				leading: 0,
				trailing: 1,
			},
			expected: "Ran 2 commands, received a message",
		},
		{
			calls: [bash()],
			messages:
			{
				leading: 1,
				trailing: 3,
			},
			expected: "Received a message, ran a command, received 3 messages",
		},
	])("labels $expected", ({calls, messages, expected}) =>
	{
		expect(received(calls, messages)).toBe(expected);
	});

	it("leads with a failed completion and trails messages before settled completions", () =>
	{
		expect(
			{
				failed: received(
					[bash()],
					{
						leading: 1,
						trailing: 0,
					},
					[failedTask],
				),
				settled: received(
					[bash()],
					{
						leading: 0,
						trailing: 1,
					},
					[finishedCommand],
				),
			},
		).toStrictEqual(
			{
				failed: "Finished a background task, received a message, ran a command, 1 failed",
				settled: "Ran a command, received a message, finished a background command",
			},
		);
	});
});

describe("group label: the fold keeps every leading part", () =>
{
	const part = (verb: string, count: number, leads = false): Parameters<typeof shapeSegmentsForTest>[0][number] => (
	{
		verb,
		rest: "x",
		count,
		failed: 0,
		stopped: 0,
		blocked: 0,
		...(leads
			?
				{
					leads: true,
				}
			: {}),
	});
	const leads = ["a", "b", "c", "d"].map((verb) => part(verb, 1, true));
	const tool = (name: string): ToolCallLike => (
	{
		name,
		input: {},
	});

	it("keeps 4 leads and 1 plain part unfolded, as folding one part saves nothing", () =>
	{
		expect(shapeSegmentsForTest([...leads, part("e", 1)])).toStrictEqual(
			{
				segments: ["a", "b", "c", "d", "e"].map((verb) => (
				{
					verb,
					rest: "x",
				})),
				trailing: null,
			},
		);
	});

	it("folds only past the last lead, totalling the folded counts", () =>
	{
		expect(shapeSegmentsForTest([...leads, part("e", 2), part("f", 3)])).toStrictEqual(
			{
				segments: [
					...["a", "b", "c"].map((verb) => (
					{
						verb,
						rest: "x",
					})),
					{
						verb: "d",
						rest: "x,",
					},
				],
				trailing: " and 5 more actions",
			},
		);
	});

	it("keeps 3 parts when nothing leads", () =>
	{
		expect(shapeSegmentsForTest(["a", "b", "c", "d", "e"].map((verb) => part(verb, 1)))).toStrictEqual(
			{
				segments: [
					{
						verb: "a",
						rest: "x",
					},
					{
						verb: "b",
						rest: "x",
					},
					{
						verb: "c",
						rest: "x,",
					},
				],
				trailing: " and 2 more actions",
			},
		);
	});

	it("leads with a failed completion and leading messages, demotes the hook re-prompt to last, then folds", () =>
	{
		expect(
			countedLabelText(
				summarizeToolCallStats(
					[bash(), tool("Grep"), tool("Glob")],
					[
						{
							status: "failed",
							command: true,
							toolUseId: null,
						},
					],
					new Set(),
					{
						leading: 1,
						trailing: 0,
						reprompted: true,
					},
				),
			),
		).toBe("Finished a background command, received a message, ran a command, and 3 more actions, 1 failed");
	});

	it("leads with the hook re-prompt only when no completion failed and no message led", () =>
	{
		const hook = (leading: number, failed: boolean): string =>
			countedLabelText(
				summarizeToolCallStats(
					[bash()],
					failed
						? [
								{
									status: "failed",
									command: true,
									toolUseId: null,
								},
							]
						: [],
					new Set(),
					{
						leading,
						trailing: 0,
						reprompted: true,
					},
				),
			);
		expect(
			{
				leads: hook(0, false),
				failedCompletion: hook(0, true),
				leadingMessage: hook(1, false),
			},
		).toStrictEqual(
			{
				leads: "Hook re-prompted Claude, ran a command",
				failedCompletion: "Finished a background command, ran a command, received hook feedback, 1 failed",
				leadingMessage: "Received a message, ran a command, received hook feedback",
			},
		);
	});
});

describe("group label: benign errors", () =>
{
	it("counts no failure for a no-op ExitWorktree", () =>
	{
		const exit: ToolCallLike =
		{
			id: "x1",
			name: "ExitWorktree",
			input:
			{
				action: "keep",
			},
			isError: true,
			result: "No-op: there is no active EnterWorktree session to exit.",
		};
		expect(label([bash(), exit])).toBe("Ran a command, used a tool");
	});
});

describe("group label: peer sends", () =>
{
	const send = (input: Record<string, unknown>, extra: Partial<ToolCallLike> = {}): ToolCallLike => (
	{
		name: "SendMessage",
		input,
		...extra,
	});

	it("counts sends to session addresses in one category part, each address once", () =>
	{
		expect(
			{
				withCommand: label([
					send(
						{
							to: "uds:/tmp/cc-socks/1.sock",
						},
					),
					bash(),
				]),
				sameAddress: label([
					send(
						{
							to: "uds:/a",
						},
					),
					send(
						{
							to: " uds:/a ",
						},
					),
				]),
				threeAddresses: label([
					send(
						{
							to: "bridge:x",
						},
					),
					send(
						{
							to: "/tmp/s.sock",
						},
					),
					send(
						{
							to: "local_0123abcd",
						},
					),
				]),
				failed: label([
					send(
						{
							to: "did:plc:1",
						},
					),
					send(
						{
							to: "uds:/b",
						},
						{
							isError: true,
						},
					),
				]),
				notHex: label([
					send(
						{
							to: "local_xyz",
						},
					),
				]),
			},
		).toStrictEqual(
			{
				withCommand: "Messaged another session, ran a command",
				sameAddress: "Messaged another session",
				threeAddresses: "Messaged 3 other sessions",
				failed: "Messaged 2 other sessions (1 failed)",
				notHex: "Messaged @local_xyz",
			},
		);
	});

	it("names each other recipient by its own group words", () =>
	{
		expect(
			{
				specimen: label([
					bash(
						{
							isError: true,
						},
					),
					send(
						{
							to: "status-photos2",
							recipient_kind: "name",
						},
					),
					send(
						{
							to: "tiktok-tasks",
							recipient_kind: "name",
						},
					),
				]),
				repeated: label([
					send(
						{
							to: "fix-ecr",
						},
					),
					send(
						{
							to: "fix-ecr",
						},
					),
				]),
				seven: label(
					["a", "b", "c", "d", "e", "f", "g"].map((to) =>
						send(
							{
								to,
							},
						),
					),
				),
				agents: label([
					send(
						{
							to: "abc123xyz",
						},
					),
					send(
						{
							to: "a0123456789abcdef",
						},
					),
					send(
						{
							to: "lead",
							recipient_kind: "agent",
						},
					),
				]),
				described: label([
					send(
						{
							to: "researcher",
						},
						{
							recipientDescription: "Survey repos",
						},
					),
				]),
				describedHandshake: label([
					send(
						{
							to: "researcher",
							message:
							{
								type: "shutdown_request",
							},
						},
						{
							recipientDescription: "Survey repos",
						},
					),
				]),
				shutdown: label([
					send(
						{
							to: "w1",
							message:
							{
								type: "shutdown_request",
							},
						},
					),
				]),
				approved: label([
					send(
						{
							to: "w1",
							message:
							{
								type: "plan_approval_response",
								approve: true,
							},
						},
					),
				]),
				anotherSession: label([
					send(
						{
							to: "",
						},
					),
					send(
						{
							to: "x",
							recipient_kind: "session",
						},
					),
				]),
				categoryThenWords: label([
					send(
						{
							to: "uds:/a",
						},
					),
					send(
						{
							to: "",
						},
					),
				]),
				broadcast: label([
					send(
						{
							to: "*",
						},
					),
				]),
				failed: label([
					send(
						{
							to: "w1",
						},
						{
							isError: true,
						},
					),
					bash(),
				]),
				stopped: label([
					send(
						{
							to: "w1",
						},
						{
							stopped: true,
						},
					),
				]),
			},
		).toStrictEqual(
			{
				specimen: "Ran a command, messaged @status-photos2, messaged @tiktok-tasks, 1 failed",
				repeated: "Messaged @fix-ecr 2 times",
				seven: "Messaged @a, messaged @b, messaged @c, and 4 more actions",
				agents: "Messaged agent 3 times",
				described: "Messaged agent",
				describedHandshake: "Messaged agent",
				shutdown: "Asked @w1 to shut down",
				approved: "Approved plan from @w1",
				anotherSession: "Messaged another session 2 times",
				categoryThenWords: "Messaged another session, messaged another session",
				broadcast: "Messaged @*",
				failed: "Ran a command, messaging @w1, 1 failed",
				stopped: "Messaging @w1 (1 stopped)",
			},
		);
	});
});
