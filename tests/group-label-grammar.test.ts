import {summarizeToolCallStats, type ToolCallLike} from "../src/lib/session-utils";

/** The group header text, joined the way upstream draws it: "Ran 2 commands, edited a.ts". */
function label(calls: ToolCallLike[]): string {
	return summarizeToolCallStats(calls)
		.segments.map((segment) => (segment.rest ? `${segment.verb} ${segment.rest}` : segment.verb))
		.join(", ");
}

const bash = (extra: Partial<ToolCallLike> = {}): ToolCallLike => ({name: "Bash", input: {command: "ls"}, ...extra});

describe("group label: memory files", () => {
	it("names a memory file like any other file, as upstream has no memory segment for Read or Write", () => {
		expect({
			write: label([
				{
					name: "Write",
					input: {file_path: "/Users/me/.claude/projects/-x/memory/little-snitch-network-blocks.md"},
				},
				bash(),
			]),
			read: label([{name: "Read", input: {file_path: "/Users/me/.claude/memory/MEMORY.md"}}, bash()]),
		}).toStrictEqual({
			write: "Created little-snitch-network-blocks.md, ran a command",
			read: "Read MEMORY.md, ran a command",
		});
	});
});

describe("group label: tool categories", () => {
	const tool = (name: string, input: Record<string, unknown> = {}): ToolCallLike => ({name, input});

	it.each([
		{calls: [tool("Skill"), bash(), bash(), bash()], expected: "Ran 3 commands, used a tool"},
		{calls: [tool("Skill"), tool("ToolSearch")], expected: "Used 2 tools"},
		{calls: [tool("mcp__a__x"), tool("mcp__a__x"), tool("mcp__plugin_b_b__y")], expected: "Used 3 tools"},
		{
			calls: [
				tool("TaskCreate"),
				tool("EnterPlanMode"),
				tool("SendMessage"),
				tool("Artifact"),
				tool("CronCreate"),
			],
			expected: "Used 5 tools",
		},
		{calls: [tool("WebSearch"), tool("WebSearch"), tool("WebFetch")], expected: "Browsed the web, fetched a page"},
		{calls: [tool("TodoWrite"), tool("TodoWrite"), bash()], expected: "Updated todos, ran a command"},
		{calls: [tool("Grep"), tool("Grep"), tool("Glob")], expected: "Searched code, found files"},
		{calls: [tool("ExitPlanMode"), tool("Agent"), tool("Task")], expected: "Proposed a plan, ran 2 agents"},
		{calls: [tool("PowerShell"), bash()], expected: "Ran 2 commands"},
		{
			calls: [
				tool("NotebookEdit", {notebook_path: "/a.ipynb"}),
				tool("NotebookEdit", {notebook_path: "/b.ipynb"}),
			],
			expected: "Edited 2 notebooks",
		},
	])("labels $expected, with every uncategorized tool in one trailing segment", ({calls, expected}) => {
		expect(label(calls)).toBe(expected);
	});
});

const edit = (filePath: string, extra: Partial<ToolCallLike> = {}): ToolCallLike => ({
	name: "Edit",
	input: {file_path: filePath, old_string: "a", new_string: "b"},
	...extra,
});
const read = (filePath: string, extra: Partial<ToolCallLike> = {}): ToolCallLike => ({
	name: "Read",
	input: {file_path: filePath},
	...extra,
});

describe("group label: distinct files", () => {
	it.each([
		{calls: [edit("/r/a.ts", {isError: true}), edit("/r/a.ts")], expected: "Edited a.ts"},
		{calls: [edit("/r/a.ts"), edit("/r/a.ts", {isError: true})], expected: "Edited a.ts (1 failed)"},
		{calls: [edit("/r/a.ts"), edit("/r/b.ts"), edit("/r/a.ts")], expected: "Edited 2 files"},
		{calls: [bash(), edit("/r/x"), edit("/r/x"), bash()], expected: "Ran 2 commands, edited x"},
		{calls: [bash({id: "b1", isError: true}), bash({id: "b2"})], expected: "Ran 2 commands (1 failed)"},
		{
			calls: [
				edit("/r/a.ts", {isError: true}),
				read("/r/b.ts"),
				read("/r/c.ts"),
				bash(),
				edit("/r/a.ts"),
				edit("/r/d.ts"),
			],
			expected: "Edited 2 files, read 2 files, ran a command",
		},
	])("counts each file once, at its last call's status: $expected", ({calls, expected}) => {
		expect(label(calls)).toBe(expected);
	});
});

describe("group label: failure suffix", () => {
	const mcp = (extra: Partial<ToolCallLike> = {}): ToolCallLike => ({name: "mcp__x__y", input: {}, ...extra});

	it.each([
		{calls: [edit("/r/k.ts", {isError: true}), bash()], expected: "Edited k.ts (1 failed), ran a command"},
		{
			calls: [read("/r/a", {isError: true}), bash(), read("/r/b"), read("/r/c"), read("/r/d"), bash()],
			expected: "Read 4 files (1 failed), ran 2 commands",
		},
		{
			calls: [
				bash({isError: true}),
				read("/r/a", {isError: true}),
				read("/r/b", {isError: true}),
				read("/r/c", {isError: true}),
			],
			expected: "Ran a command (1 failed), read 3 files (3 failed)",
		},
		{calls: [mcp({isError: true}), bash(), mcp()], expected: "Ran a command, used 2 tools (1 failed)"},
	])("attaches each failure to its own segment: $expected", ({calls, expected}) => {
		expect(label(calls)).toBe(expected);
	});
});

describe("group label: rejected and interrupted calls", () => {
	it.each([
		{calls: [bash(), bash(), bash({isError: true, stopped: true})], expected: "Ran 3 commands"},
		{calls: [bash({isError: true, denied: true}), bash()], expected: "Ran 2 commands"},
		{calls: [{name: "mcp__x__y", input: {}, isError: true, stopped: true}], expected: "Used a tool"},
		{calls: [edit("/r/a.ts"), edit("/r/a.ts", {isError: true, stopped: true})], expected: "Edited a.ts"},
		{
			calls: [edit("/r/a.ts", {isError: true}), edit("/r/a.ts", {isError: true, denied: true})],
			expected: "Edited a.ts (1 failed)",
		},
	])("counts the call with no failure, keeping its file's earlier status: $expected", ({calls, expected}) => {
		expect(label(calls)).toBe(expected);
	});
});

describe("group label: one file", () => {
	const write = (filePath: string, writeType?: "create" | "update"): ToolCallLike =>
		writeType === undefined
			? {name: "Write", input: {file_path: filePath, content: "x"}}
			: {name: "Write", input: {file_path: filePath, content: "x"}, resultMeta: {writeType}};
	const notebook = (path: string): ToolCallLike => ({name: "NotebookEdit", input: {notebook_path: path}});

	it.each([
		{calls: [read("/r/x.ts"), edit("/r/y.ts")], expected: "Read a file, edited a file"},
		{calls: [read("/r/x.ts"), edit("/r/x.ts")], expected: "Read and edited x.ts"},
		{calls: [edit("/r/x.ts"), read("/r/x.ts")], expected: "Edited and read x.ts"},
		{calls: [write("/r/x.ts", "create"), edit("/r/x.ts")], expected: "Created and edited x.ts"},
		{calls: [write("/r/x.ts", "update"), bash()], expected: "Edited x.ts, ran a command"},
		{
			calls: [{...write("/r/x.ts"), isError: true}, bash(), read("/r/x.ts"), write("/r/x.ts", "update")],
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
		{calls: [read("/r/x.ts"), read("/r/x.ts")], expected: "Read x.ts"},
		{calls: [read("/r/x.ts"), {name: "Read", input: {}}], expected: "Read 2 files"},
		{calls: [notebook("/r/n.ipynb"), read("/r/n.ipynb")], expected: "Edited and read n.ipynb"},
		{
			calls: [edit("/r/A.java", {isError: true}), bash(), read("/r/A.java"), edit("/r/A.java"), bash()],
			expected: "Edited and read A.java, ran 2 commands",
		},
		{
			calls: [read("/r/x.ts", {isError: true}), edit("/r/x.ts", {isError: true})],
			expected: "Read and edited x.ts (2 failed)",
		},
	])("names the file only when the whole group touches just it: $expected", ({calls, expected}) => {
		expect(label(calls)).toBe(expected);
	});
});

describe("group label: cap", () => {
	const tool = (name: string, extra: Partial<ToolCallLike> = {}): ToolCallLike => ({name, input: {}, ...extra});

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
				{...tool("Write"), input: {file_path: "/r/a"}},
				read("/r/b"),
				edit("/r/c"),
			],
			expected: "Ran 4 commands, created a file, read a file, edited a file",
		},
		{
			calls: [bash(), tool("Grep"), tool("Glob"), tool("WebSearch"), tool("mcp__x__y", {isError: true})],
			expected: "Ran a command, searched code, found files, and 2 more actions (1 failed)",
		},
	])("keeps the first three of five or more segments: $expected", ({calls, expected}) => {
		expect(label(calls)).toBe(expected);
	});

	it("counts background completions among the dropped actions", () => {
		const segments = summarizeToolCallStats(
			[bash(), tool("Grep"), tool("Glob"), tool("WebSearch")],
			[
				{command: true, status: "completed"},
				{command: true, status: "completed"},
			],
		).segments;

		expect(segments).toStrictEqual([
			{verb: "Ran", rest: "a command"},
			{verb: "searched", rest: "code"},
			{verb: "found", rest: "files"},
			{verb: "and", rest: "3 more actions"},
		]);
	});
});
