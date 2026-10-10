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
