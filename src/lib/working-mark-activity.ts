/**
 * Which sprite upstream claude.ai/code's WorkingMark plays: a port of the
 * shared activity resolver (`Yx`/`L3`/`SR`) and the loop sheet table.
 */

export type WorkingMarkActivity = "default" | "think" | "search" | "read" | "code" | "write" | "compose" | "blocked";

/** Frames in each activity's loop sheet (upstream `SHEETS["<activity>.loop"].frames`). */
export const WORKING_MARK_FRAMES = {
	default: 40,
	think: 110,
	search: 20,
	read: 60,
	code: 75,
	write: 60,
	compose: 62,
	blocked: 30,
} as const satisfies Record<WorkingMarkActivity, number>;

/** Upstream's per-frame duration (`speed`) for every sheet. */
export const WORKING_MARK_FRAME_MS = 33.3333;

/** Local tool names mapped onto upstream's `Zo` table keys' activities. */
const TOOL_ACTIVITY: Readonly<Record<string, WorkingMarkActivity>> = {
	Read: "read",
	Glob: "read",
	Grep: "read",
	Write: "write",
	Edit: "write",
	MultiEdit: "write",
	NotebookEdit: "write",
	TodoWrite: "write",
	WebFetch: "search",
	WebSearch: "search",
	BashOutput: "code",
	KillShell: "code",
};

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

const SEARCH_TOOLS = new Set(["image_search", "launch_extended_search_task"]);
const READ_WORDS = new Set([
	"read",
	"view",
	"get",
	"list",
	"fetch",
	"search",
	"find",
	"query",
	"retrieve",
	"lookup",
	"load",
	"open",
	"ls",
]);
const WRITE_WORDS = new Set([
	"write",
	"edit",
	"create",
	"update",
	"delete",
	"remove",
	"append",
	"insert",
	"replace",
	"patch",
	"send",
	"post",
	"add",
	"save",
	"upload",
	"comment",
	"artifacts",
]);
const CODE_WORDS = new Set([
	"bash",
	"exec",
	"execute",
	"run",
	"shell",
	"python",
	"repl",
	"script",
	"eval",
	"javascript",
]);

/** Upstream `SR`: the leading word of a description and its likely stems. */
function verbForms(description: string): string[] {
	const word = /^\s*([A-Za-z]+)/.exec(description)?.[1]?.toLowerCase();
	if (word === undefined) return [];
	if (word.endsWith("ing") && word.length > 5) {
		const stem = word.slice(0, -3);
		return [word, stem, `${stem}e`, stem.replace(/([b-df-hj-np-tv-z])\1$/, "$1")];
	}
	if (word.endsWith("ies")) return [word, `${word.slice(0, -3)}y`];
	if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return [word, word.slice(0, -1)];
	return [word];
}

/** Upstream `L3`: a shell call reads or writes when its description's verb says so. */
function shellActivity(input: Readonly<Record<string, unknown>>): WorkingMarkActivity {
	const description = input["description"];
	if (typeof description === "string") {
		for (const form of verbForms(description)) {
			if (WRITE_WORDS.has(form)) return "write";
			if (READ_WORDS.has(form)) return "read";
		}
	}
	return "code";
}

/** The activity sprite for an in-flight tool call. */
export function toolMarkActivity(name: string, input: Readonly<Record<string, unknown>>): WorkingMarkActivity {
	if (SHELL_TOOLS.has(name)) return shellActivity(input);
	const known = TOOL_ACTIVITY[name];
	if (known !== undefined) return known;
	const bare = name.replace(/^mcp__.+?__/, "").toLowerCase();
	if (SEARCH_TOOLS.has(bare)) return "search";
	if (bare.startsWith("memory_")) return /^memory_(read|list|search|view)$/.test(bare) ? "read" : "write";
	for (const word of bare.split(/[\s:_-]+/)) {
		if (WRITE_WORDS.has(word)) return "write";
		if (CODE_WORDS.has(word)) return "code";
		if (READ_WORDS.has(word)) return "read";
	}
	return "default";
}

/** The busy working line's sprite: think while a thinking block streams. */
export function workingLineActivity(thinking: boolean): WorkingMarkActivity {
	return thinking ? "think" : "default";
}
