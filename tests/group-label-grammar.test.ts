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
