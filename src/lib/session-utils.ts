/**
 * Minimal shape needed by summarizeToolCalls, categorize, and diffStatsForCall.
 * Satisfied by raw content blocks, readSession tool call objects, and test data alike.
 */
export interface ToolCallLike {
	/** The tool_use id, which keys a call that names no file. */
	id?: string | undefined;
	name: string;
	input: Record<string, unknown>;
	isError?: boolean | undefined;
}

const COMMAND_MESSAGE_RE = /<command-message[^>]*>([\s\S]*?)<\/command-message>/;
const STRIP_BLOCK_RE =
	/<(?:command-name|command-args|local-command-stdout)[^>]*>[\s\S]*?<\/(?:command-name|command-args|local-command-stdout)>/g;
const STRIP_TAG_RE =
	/<\/?(?:command-message|command-name|command-args|command|local-command-caveat|local-command-stdout)[^>]*>/g;

function cleanCommandText(text: string): string {
	const msgMatch = text.match(COMMAND_MESSAGE_RE);
	if (msgMatch) {
		return msgMatch[1]!.replace(STRIP_TAG_RE, "").trim();
	}
	return text.replace(STRIP_BLOCK_RE, "").replace(STRIP_TAG_RE, "").trim();
}

export function stripCommandTags(text: string): string {
	return cleanCommandText(text);
}

const BASH_INPUT_RE = /^\s*<bash-input>([\s\S]*?)<\/bash-input>\s*$/;
const BASH_OUTPUT_RE = /^\s*<bash-stdout>([\s\S]*?)<\/bash-stdout>\s*<bash-stderr>([\s\S]*?)<\/bash-stderr>\s*$/;

export function parseBashInput(text: string): {command: string} | null {
	const m = text.match(BASH_INPUT_RE);
	if (!m) return null;
	return {command: m[1]!};
}

export function parseBashOutput(text: string): {stdout: string; stderr: string} | null {
	const m = text.match(BASH_OUTPUT_RE);
	if (!m) return null;
	return {stdout: m[1]!, stderr: m[2]!};
}

export function parseCommandBlock(text: string): {name: string; args?: string} | null {
	const nameMatch = text.match(/<command-name>(.*?)<\/command-name>/);
	if (!nameMatch) return null;
	const argsMatch = text.match(/<command-args>(.*?)<\/command-args>/s);
	const args = argsMatch?.[1]?.trim();
	const result: {name: string; args?: string} = {name: nameMatch[1]!};
	if (args) result.args = args;
	return result;
}

const ARG_BLOCK_RE = /<(description|instructions|arguments|args|user-request)>([\s\S]*?)<\/\1>/;
const ARG_TAG_RE = /<\/?(?:description|instructions|arguments|args|user-request)>/g;

/**
 * Reduce an expanded slash-command prompt to the user's own words. Command
 * bodies wrap `$ARGUMENTS` in a block such as `<description>`, so that block is
 * the intent and everything around it is template boilerplate. When the user
 * passed no arguments the block is empty and the command's own opening line is
 * the best summary available.
 *
 * Only ever applied to `isMeta` prompts. A command body is injected by the CLI
 * rather than typed, and it carries no markers of its own — the `<command-name>`
 * header lands in a separate record — so `isMeta` is the only signal that these
 * tags are template scaffolding and not something the user pasted.
 */
function stripCommandBoilerplate(text: string): string {
	const match = text.match(ARG_BLOCK_RE);
	if (match) {
		const args = match[2]!.trim();
		if (args) return args;

		const openingLine = text.slice(0, match.index!).trim().split("\n")[0];
		if (openingLine) return openingLine;
	}
	return text.replace(ARG_TAG_RE, "");
}

const REQUEST_INTERRUPTED_RE = /^\[Request interrupted by user.*\]\s*$/;

/**
 * Whether a user record is the marker the CLI writes in place of the turn the
 * user cut short with ESC. Nothing in it came from the keyboard.
 */
export function isRequestInterrupted(text: string): boolean {
	return REQUEST_INTERRUPTED_RE.test(text.trim());
}

/** The user's own words, with command scaffolding and line breaks removed. */
function titleText(text: string, options?: {isMeta?: boolean}): string {
	const command = cleanCommandText(text);
	const boilerplateFree = options?.isMeta === true ? stripCommandBoilerplate(command) : command;
	return boilerplateFree.replace(/\s+/g, " ").trim();
}

/**
 * Words that name no work of their own: bare affirmations, acknowledgements,
 * and continuations. A prompt built only from these is an answer to something
 * the assistant asked, not a request.
 */
const CONTINUATION_WORDS = new Set([
	"again",
	"ahead",
	"all",
	"and",
	"any",
	"carry",
	"continue",
	"cool",
	"correct",
	"do",
	"done",
	"exactly",
	"fine",
	"go",
	"going",
	"good",
	"great",
	"hm",
	"hmm",
	"indeed",
	"it",
	"k",
	"keep",
	"more",
	"n",
	"nah",
	"next",
	"nice",
	"no",
	"nope",
	"now",
	"of",
	"ok",
	"okay",
	"on",
	"one",
	"perfect",
	"please",
	"proceed",
	"resume",
	"right",
	"sounds",
	"still",
	"sure",
	"thank",
	"thanks",
	"that",
	"the",
	"them",
	"then",
	"these",
	"this",
	"those",
	"thx",
	"to",
	"try",
	"up",
	"x",
	"y",
	"ya",
	"yeah",
	"yep",
	"yes",
	"you",
	"yup",
]);

/** Shorter than this and a prompt cannot say what a session is for. */
const MIN_INFORMATIVE_LENGTH = 3;

/**
 * Whether a user message says anything about the work a session does. A
 * session resumed or continued opens with the user answering an earlier
 * question -- "yes", "x", "resume" -- and a title built from that record names
 * nothing, so the title falls through to the next message that does.
 *
 * Word matching is deliberately ASCII-only: a prompt written in a script this
 * list cannot spell has no continuation words to find and counts as informative
 * on its length alone.
 */
export function isInformativePrompt(text: string, options?: {isMeta?: boolean}): boolean {
	const cleaned = titleText(text, options);
	if (cleaned.length < MIN_INFORMATIVE_LENGTH) return false;
	const words = cleaned.toLowerCase().match(/[a-z0-9']+/g);
	if (words === null) return true;
	return !words.every((word) => CONTINUATION_WORDS.has(word));
}

export function extractSessionTitle(text: string, fallback?: string, options?: {isMeta?: boolean}): string {
	const cleaned = titleText(text, options);
	if (!cleaned) return fallback ?? "Untitled Session";

	if (cleaned.length <= 80) return cleaned;

	const truncated = cleaned.slice(0, 80);
	const lastSpace = truncated.lastIndexOf(" ");
	if (lastSpace > 40) {
		return truncated.slice(0, lastSpace) + "...";
	}
	return truncated + "...";
}

/**
 * The tools upstream gives their own group-header segment. Every other tool --
 * Skill, ToolSearch, MCP tools, the Task* family, SendMessage, Artifact -- folds
 * into one trailing "used N tools" segment.
 */
const CATEGORY_BY_TOOL = {
	Read: "read",
	Write: "write",
	Edit: "edit",
	MultiEdit: "edit",
	NotebookEdit: "notebook",
	Bash: "bash",
	PowerShell: "bash",
	Grep: "grep",
	Glob: "glob",
	WebSearch: "websearch",
	WebFetch: "webfetch",
	Agent: "agent",
	Task: "agent",
	TodoWrite: "todo",
	ExitPlanMode: "planexit",
} as const;

type ToolCategory = (typeof CATEGORY_BY_TOOL)[keyof typeof CATEGORY_BY_TOOL];

interface SegmentLabel {
	verb: string;
	/** The rest for a single call or file. */
	one: string;
	/** The rest for several, with `{n}` standing for the count. */
	many: string;
}

const FILE_NOUNS = {one: "a file", many: "{n} files"};

const CATEGORY_LABELS: Record<ToolCategory, SegmentLabel> = {
	read: {verb: "Read", ...FILE_NOUNS},
	write: {verb: "Created", ...FILE_NOUNS},
	edit: {verb: "Edited", ...FILE_NOUNS},
	notebook: {verb: "Edited", one: "a notebook", many: "{n} notebooks"},
	bash: {verb: "Ran", one: "a command", many: "{n} commands"},
	grep: {verb: "Searched", one: "code", many: "code"},
	glob: {verb: "Found", one: "files", many: "files"},
	websearch: {verb: "Browsed", one: "the web", many: "the web"},
	webfetch: {verb: "Fetched", one: "a page", many: "{n} pages"},
	agent: {verb: "Ran", one: "an agent", many: "{n} agents"},
	todo: {verb: "Updated", one: "todos", many: "todos"},
	planexit: {verb: "Proposed", one: "a plan", many: "a plan"},
};

const OTHER_TOOLS_LABEL: SegmentLabel = {verb: "Used", one: "a tool", many: "{n} tools"};

/**
 * Categories whose calls change a file, each with the verb upstream Normal uses
 * for it: a `Write` creates a file ("Created cache.ts") while `Edit` and
 * `MultiEdit` change one that exists ("Edited cache.ts").
 */
const MUTATION_VERBS = {edit: "Edited", write: "Created"} as const;

type MutationCategory = keyof typeof MUTATION_VERBS;

function isMutation(cat: ToolCategory): cat is MutationCategory {
	return cat === "edit" || cat === "write";
}

function countDiffLines(oldStr: string, newStr: string): {added: number; removed: number} {
	if (oldStr === newStr) return {added: 0, removed: 0};
	const oldLines = oldStr === "" ? [] : oldStr.split("\n");
	const newLines = newStr === "" ? [] : newStr.split("\n");
	const oldCounts = new Map<string, number>();
	for (const line of oldLines) oldCounts.set(line, (oldCounts.get(line) ?? 0) + 1);
	const newCounts = new Map<string, number>();
	for (const line of newLines) newCounts.set(line, (newCounts.get(line) ?? 0) + 1);

	let added = 0;
	for (const [line, count] of newCounts) {
		const inOld = oldCounts.get(line) ?? 0;
		if (count > inOld) added += count - inOld;
	}
	let removed = 0;
	for (const [line, count] of oldCounts) {
		const inNew = newCounts.get(line) ?? 0;
		if (count > inNew) removed += count - inNew;
	}
	return {added, removed};
}

/** One old/new string pair applied by an `Edit` or `MultiEdit` tool call. */
export interface EditDiffEntry {
	oldStr: string;
	newStr: string;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/**
 * The replacements a file-editing tool call performs, in order. `Edit` carries a
 * single pair at the top level; `MultiEdit` carries an `edits[]` array and falls
 * back to the top-level pair when that array is absent or empty.
 */
export function editDiffEntries(input: Record<string, unknown>): EditDiffEntry[] {
	const edits = input["edits"];
	if (Array.isArray(edits)) {
		const entries = edits
			.filter((edit): edit is Record<string, unknown> => typeof edit === "object" && edit !== null)
			.map((edit) => ({
				oldStr: asString(edit["old_string"]),
				newStr: asString(edit["new_string"]),
			}));
		if (entries.length > 0) return entries;
	}
	if (typeof input["old_string"] !== "string") return [];
	return [{oldStr: asString(input["old_string"]), newStr: asString(input["new_string"])}];
}

export function diffStatsForCall(call: ToolCallLike): {
	added: number;
	removed: number;
} {
	const input = call.input;
	if (call.name === "Write") {
		const content = asString(input["content"]);
		const added = content === "" ? 0 : content.split("\n").length;
		return {added, removed: 0};
	}
	if (call.name === "Edit" || call.name === "MultiEdit") {
		let added = 0;
		let removed = 0;
		for (const entry of editDiffEntries(input)) {
			const stats = countDiffLines(entry.oldStr, entry.newStr);
			added += stats.added;
			removed += stats.removed;
		}
		return {added, removed};
	}
	return {added: 0, removed: 0};
}

function categorize(call: ToolCallLike): ToolCategory | null {
	return Object.hasOwn(CATEGORY_BY_TOOL, call.name)
		? CATEGORY_BY_TOOL[call.name as keyof typeof CATEGORY_BY_TOOL]
		: null;
}

export function formatToolName(toolName: string): string {
	if (toolName.startsWith("mcp__")) {
		const withoutPrefix = toolName.slice("mcp__".length);
		const serverName = withoutPrefix.split("__")[0]!;
		if (serverName.startsWith("plugin_")) {
			const segments = serverName.split("_");
			return segments[segments.length - 1]!;
		}
		return serverName;
	}
	return toolName;
}

function lowercaseFirst(text: string): string {
	return text.charAt(0).toLowerCase() + text.slice(1);
}

function pluralize(count: number, singular: string, plural: string): string {
	if (count === 1) return singular;
	return plural.replace("{n}", String(count));
}

/**
 * Extract text from a tool_result content field.
 * Content can be a plain string or an array of {type: 'text', text: string} blocks.
 */
export function extractToolResultContent(content: unknown): string | undefined {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const texts: string[] = [];
		for (const item of content) {
			if (typeof item === "object" && item !== null && "type" in item && "text" in item) {
				const block = item as {type: string; text: string};
				if (block.type === "text" && typeof block.text === "string") {
					texts.push(block.text);
				}
			}
		}
		return texts.length > 0 ? texts.join("\n") : undefined;
	}
	return undefined;
}

/**
 * Strip non-rendering wrapper tags from tool result text.
 */
export function stripResultTags(text: string): string {
	let result = text;
	result = result.replace(/<\/?tool_use_error>/g, "");
	result = result.replace(/<\/?persisted-output>/g, "");
	result = result.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
	if (result !== text) result = result.trim();
	return result;
}

/**
 * Truncate text to a maximum number of lines, appending a count of omitted lines.
 */
export function truncateResult(text: string, maxLines: number): string {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return text;
	const truncated = lines.slice(0, maxLines);
	truncated.push(`... (${lines.length - maxLines} more lines)`);
	return truncated.join("\n");
}

/**
 * Structured summary segment: a verb and its rest text, for span-based rendering.
 * Upstream claude.ai/code renders each segment as:
 *   <span class="text-body text-secondary">{verb}</span>
 *   <span class="text-secondary"> {rest}</span>
 */
export interface SummarySegment {
	verb: string;
	rest: string;
}

/**
 * A summary row's label segments plus the totals upstream renders beside them:
 * the git-coloured `+added -removed` span and the " (N failed)" suffix.
 */
/** A background task whose completion notification folded into a tool group. */
export interface BackgroundCompletionLike {
	/** A `run_in_background` Bash command rather than an agent or monitor. */
	command: boolean;
	status: "completed" | "failed" | "stopped";
}

export interface ToolCallSummaryStats {
	segments: SummarySegment[];
	added: number;
	removed: number;
	failed: number;
}

function basenameFromPath(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	if (lastSlash === -1) return path;
	return path.slice(lastSlash + 1);
}

function filePathOf(call: ToolCallLike | undefined): string | null {
	if (!call) return null;
	const filePath = call.input["file_path"];
	if (typeof filePath !== "string" || filePath === "") return null;
	return filePath;
}

function singleFileBasename(call: ToolCallLike | undefined): string | null {
	const filePath = filePathOf(call);
	return filePath === null ? null : basenameFromPath(filePath);
}

/**
 * The one file-changing category eligible for coalescing: exactly one call, and
 * the other mutation category absent, so the compound verb names it without
 * dropping a segment.
 */
function soleMutationCategory(counts: Map<ToolCategory, number>): MutationCategory | null {
	const present = (Object.keys(MUTATION_VERBS) as MutationCategory[]).filter((cat) => counts.has(cat));
	const only = present[0];
	if (present.length !== 1 || counts.get(only!) !== 1) return null;
	return only!;
}

/**
 * Upstream Normal collapses a read and a change of the SAME file into a single
 * segment whose verb names both actions in the order they happened -- "Read and
 * edited cache.ts", "Read and created index.ts", "Edited and read cache.ts" --
 * rather than two segments.
 */
function coalescedReadMutation(
	counts: Map<ToolCategory, number>,
	firstCall: Map<ToolCategory, ToolCallLike>,
): {verb: string; emitter: ToolCategory; basename: string; mutation: MutationCategory} | null {
	if (counts.get("read") !== 1) return null;
	const mutation = soleMutationCategory(counts);
	if (mutation === null) return null;
	const readPath = filePathOf(firstCall.get("read"));
	if (readPath === null || readPath !== filePathOf(firstCall.get(mutation))) return null;
	const basename = basenameFromPath(readPath);
	const mutationVerb = MUTATION_VERBS[mutation];
	for (const cat of counts.keys()) {
		if (cat === "read") {
			return {
				verb: `Read and ${mutationVerb.toLowerCase()}`,
				emitter: "read",
				basename,
				mutation,
			};
		}
		if (cat === mutation) {
			return {verb: `${mutationVerb} and read`, emitter: mutation, basename, mutation};
		}
	}
	return null;
}

type CallOutcome = "succeeded" | "failed";

/**
 * What upstream counts once in a segment: the file a call touches, so three
 * edits of one file are "Edited a.ts", or else the call itself. Each key keeps
 * the outcome of its last call, so a failed edit retried successfully is no
 * failure.
 */
function callKey(call: ToolCallLike, index: number): string {
	const path = call.input["file_path"] ?? call.input["notebook_path"];
	if (typeof path === "string") return `path:${path}`;
	return call.id === undefined ? `index:${index}` : `id:${call.id}`;
}

function countFailed(byKey: Map<string, CallOutcome>): number {
	let failed = 0;
	for (const outcome of byKey.values()) if (outcome === "failed") failed++;
	return failed;
}

function labelledSegment(label: SegmentLabel, count: number, name: string | null = null): SummarySegment {
	return {verb: label.verb, rest: name ?? pluralize(count, label.one, label.many)};
}

function buildSummarySegments(
	calls: ToolCallLike[],
	completions: readonly BackgroundCompletionLike[] = [],
): ToolCallSummaryStats {
	// Insertion order carries the summary order: upstream Normal writes both
	// "Updated todos, read 3 files" and "Read index.ts, updated todos", so
	// segments follow the order each tool was first called.
	const outcomes = new Map<ToolCategory, Map<string, CallOutcome>>();
	const firstCall = new Map<ToolCategory, ToolCallLike>();
	let otherTools = 0;
	let otherFailed = 0;
	let added = 0;
	let removed = 0;

	calls.forEach((call, index) => {
		const cat = categorize(call);
		const outcome: CallOutcome = call.isError === true ? "failed" : "succeeded";
		if (cat === null) {
			otherTools++;
			if (outcome === "failed") otherFailed++;
			return;
		}
		let byKey = outcomes.get(cat);
		if (byKey === undefined) {
			byKey = new Map();
			outcomes.set(cat, byKey);
			firstCall.set(cat, call);
		}
		byKey.set(callKey(call, index), outcome);
		if (isMutation(cat)) {
			const s = diffStatsForCall(call);
			added += s.added;
			removed += s.removed;
		}
	});

	const counts = new Map([...outcomes].map(([cat, byKey]) => [cat, byKey.size]));
	let failed = otherFailed;
	for (const byKey of outcomes.values()) failed += countFailed(byKey);

	// A read and a change of the same file collapse into one compound segment,
	// emitted in place of whichever of the two categories came first.
	const compound = coalescedReadMutation(counts, firstCall);

	const segments: SummarySegment[] = [];
	let bashSegment: SummarySegment | null = null;
	for (const [cat, count] of counts) {
		if (compound !== null && (cat === "read" || cat === compound.mutation)) {
			if (cat === compound.emitter) {
				segments.push({
					verb: compound.verb,
					rest: compound.basename,
				});
			}
			continue;
		}
		const singleFilename =
			count === 1 && (cat === "read" || isMutation(cat)) ? singleFileBasename(firstCall.get(cat)) : null;
		const segment = labelledSegment(CATEGORY_LABELS[cat], count, singleFilename);
		if (cat === "bash") bashSegment = segment;
		segments.push(segment);
	}

	if (otherTools > 0) segments.push(labelledSegment(OTHER_TOOLS_LABEL, otherTools));

	// Upstream reports failures on the command segment -- "Ran 3 commands (1
	// failed)" -- falling back to the leading segment when no command ran.
	if (failed > 0 && segments.length > 0) {
		const bashIndex = segments.findIndex((segment) => segment === bashSegment);
		const target = segments[bashIndex === -1 ? 0 : bashIndex]!;
		target.rest = `${target.rest} (${failed} failed)`.trimStart();
	}

	// Upstream folds background completions in last: "Ran a command, finished
	// a background command", "Used a tool, finished a background task (1 stopped)",
	// but leads with them when one failed: "Finished a background command (1 failed),
	// ran a command". A group mixing failed and stopped completions is unobserved.
	if (completions.length > 0) {
		const noun = completions.every((completion) => completion.command) ? "command" : "task";
		const stopped = completions.filter((completion) => completion.status === "stopped").length;
		const failedCompletions = completions.filter((completion) => completion.status === "failed").length;
		const rest = pluralize(completions.length, `a background ${noun}`, `{n} background ${noun}s`);
		if (failedCompletions > 0) {
			segments.unshift({verb: "Finished", rest: `${rest} (${failedCompletions} failed)`});
		} else {
			segments.push({verb: "Finished", rest: stopped > 0 ? `${rest} (${stopped} stopped)` : rest});
		}
	}

	// Upstream capitalizes only the leading verb: "Ran 2 commands, read cache.ts".
	return {
		segments: segments.map((segment, i) =>
			i === 0 ? segment : {verb: lowercaseFirst(segment.verb), rest: segment.rest},
		),
		added,
		removed,
		failed,
	};
}

export function summarizeToolCallStats(
	calls: ToolCallLike[],
	completions: readonly BackgroundCompletionLike[] = [],
): ToolCallSummaryStats {
	return buildSummarySegments(calls, completions);
}

export function summarizeToolCallsStructured(calls: ToolCallLike[]): SummarySegment[] {
	if (calls.length === 0) return [];
	return buildSummarySegments(calls).segments;
}

/** Upstream shows both counts whenever either is non-zero: "+0 -28". */
export function hasDiffStats(stats: {added: number; removed: number}): boolean {
	return stats.added > 0 || stats.removed > 0;
}

export function summarizeToolCalls(calls: ToolCallLike[]): string {
	const summary = buildSummarySegments(calls);
	const label = summary.segments.map((s) => `${lowercaseFirst(s.verb)} ${s.rest}`.trimEnd()).join(", ");
	return hasDiffStats(summary) ? `${label} +${summary.added} -${summary.removed}` : label;
}
