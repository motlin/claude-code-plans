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
	/** The user rejected or interrupted the call, so it settled without failing. */
	stopped?: boolean | undefined;
	/** The user rejected the call with a typed reply, so it settled without failing. */
	denied?: boolean | undefined;
	/**
	 * Whether a Write created its file or updated one that existed, and the
	 * lines the result's patch says a file edit added and removed.
	 */
	resultMeta?: {writeType?: "create" | "update"; patchStats?: {added: number; removed: number}} | undefined;
}

const COMMAND_MESSAGE_RE = /<command-message[^>]*>([\s\S]*?)<\/command-message>/;
const STRIP_BLOCK_RE =
	/<(?:command-name|command-args|local-command-stdout)[^>]*>[\s\S]*?<\/(?:command-name|command-args|local-command-stdout)>/g;
const STRIP_TAG_RE =
	/<\/?(?:command-message|command-name|command-args|command|local-command-caveat|local-command-stdout)[^>]*>/g;

/**
 * A paste the CLI wraps on lines of its own -- `<pasted_content id="5216">`, the
 * pasted text, then `</pasted_content id="5216">` -- which upstream shows as the
 * bare text. A tag quoted mid-line is something the user typed and stays.
 */
const PASTED_CONTENT_RE = /(^|\n)<pasted_content id="([^"\n]*)">\n(?:([\s\S]*?)\n)?<\/pasted_content id="\2">(?=\n|$)/g;

/** Keep the paste's text, and the line break before its opening tag, in place of the wrapper. */
const PASTED_CONTENT_TEXT = "$1$3";

/** The prompt with each pasted_content wrapper replaced by the text it wraps. */
export function unwrapPastedContent(text: string): string {
	return text.replace(PASTED_CONTENT_RE, PASTED_CONTENT_TEXT);
}

function cleanCommandText(rawText: string): string {
	const text = rawText.replace(PASTED_CONTENT_RE, PASTED_CONTENT_TEXT);
	const message = text.match(COMMAND_MESSAGE_RE)?.[1];
	if (message !== undefined) {
		return message.replace(STRIP_TAG_RE, "").trim();
	}
	return text.replace(STRIP_BLOCK_RE, "").replace(STRIP_TAG_RE, "").trim();
}

export function stripCommandTags(text: string): string {
	return cleanCommandText(text);
}

const BASH_INPUT_RE = /^\s*<bash-input>([\s\S]*?)<\/bash-input>\s*$/;
const BASH_OUTPUT_RE = /^\s*<bash-stdout>([\s\S]*?)<\/bash-stdout>\s*<bash-stderr>([\s\S]*?)<\/bash-stderr>\s*$/;

export function parseBashInput(text: string): {command: string} | null {
	const command = text.match(BASH_INPUT_RE)?.[1];
	return command === undefined ? null : {command};
}

export function parseBashOutput(text: string): {stdout: string; stderr: string} | null {
	const [, stdout, stderr] = text.match(BASH_OUTPUT_RE) ?? [];
	if (stdout === undefined || stderr === undefined) return null;
	return {stdout, stderr};
}

export function parseCommandBlock(text: string): {name: string; args?: string} | null {
	const name = text.match(/<command-name>(.*?)<\/command-name>/)?.[1];
	if (name === undefined) return null;
	const argsMatch = text.match(/<command-args>(.*?)<\/command-args>/s);
	const args = argsMatch?.[1]?.trim();
	const result: {name: string; args?: string} = {name};
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
	const rawArgs = match?.[2];
	if (match && rawArgs !== undefined) {
		const args = rawArgs.trim();
		if (args) return args;

		const openingLine = text.slice(0, match.index).trim().split("\n")[0];
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
const RECEIVED_LABEL: SegmentLabel = {verb: "Received", one: "a message", many: "{n} messages"};

/** Categories whose calls change a file, so their diff stats sum into the header. */
function isMutation(cat: ToolCategory): boolean {
	return cat === "edit" || cat === "write";
}

/** Categories that name a file, which collapse into one segment when the group touches only one file. */
const FILE_CATEGORIES: ReadonlySet<ToolCategory> = new Set(["read", "write", "edit", "notebook"]);

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
	// Upstream trusts the result's patch over counting the call's own input.
	const patchStats = call.resultMeta?.patchStats;
	if (patchStats !== undefined && (call.name === "Write" || call.name === "Edit" || call.name === "MultiEdit")) {
		return patchStats;
	}
	if (call.name === "Write") {
		const content = asString(input["content"]);
		// A final newline ends the last line rather than starting another, as upstream counts it.
		const added = content === "" ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
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
		const serverName = withoutPrefix.split("__")[0] ?? withoutPrefix;
		if (serverName.startsWith("plugin_")) {
			const segments = serverName.split("_");
			return segments.at(-1) ?? serverName;
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
	/** The tool_use id of the call that launched the task. */
	toolUseId?: string | null | undefined;
}

/** Agent messages folded into a tool group: those before its first tool, and those after it. */
export interface ReceivedMessages {
	leading: number;
	trailing: number;
	/** A Stop hook's feedback re-prompted Claude straight into the group's first tool. */
	reprompted?: boolean;
}

const NO_RECEIVED: ReceivedMessages = {leading: 0, trailing: 0};

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

function filePathOf(call: ToolCallLike): string | null {
	const path = call.input["file_path"] ?? call.input["notebook_path"];
	return typeof path === "string" ? path : null;
}

/**
 * The tool's category, except that a Write upstream reports as updating an
 * existing file counts as an edit. The first Write of a path to report either
 * decides for all of them, so a file the group created stays created.
 */
function categorizeWithWrites(calls: ToolCallLike[]): (ToolCategory | null)[] {
	const firstWriteType = new Map<string, "create" | "update">();
	for (const call of calls) {
		const path = filePathOf(call);
		const writeType = call.resultMeta?.writeType;
		if (call.name === "Write" && path !== null && writeType !== undefined && !firstWriteType.has(path)) {
			firstWriteType.set(path, writeType);
		}
	}
	return calls.map((call) => {
		const cat = categorize(call);
		const path = filePathOf(call);
		return cat === "write" && path !== null && firstWriteType.get(path) === "update" ? "edit" : cat;
	});
}

/**
 * The one file every file call in the group touched, or null when some call
 * named none or they touched several. Upstream then names the file instead of
 * counting: "Read and edited cache.ts", never "Read a.ts, edited b.ts".
 */
function soleFilePath(calls: ToolCallLike[], categories: (ToolCategory | null)[]): string | null {
	const paths = new Set<string>();
	for (const [index, call] of calls.entries()) {
		const cat = categories[index];
		if (cat === null || cat === undefined || !FILE_CATEGORIES.has(cat)) continue;
		const path = filePathOf(call);
		if (path === null) return null;
		paths.add(path);
	}
	return paths.size === 1 ? ([...paths][0] ?? null) : null;
}

const VERB_LIST = new Intl.ListFormat("en", {type: "conjunction"});

type CallOutcome = "succeeded" | "failed";

/**
 * What upstream counts once in a segment: the file a call touches, so three
 * edits of one file are "Edited a.ts", or else the call itself. Each key keeps
 * the outcome of its last call, so a failed edit retried successfully is no
 * failure.
 */
function callKey(call: ToolCallLike, index: number): string {
	const path = filePathOf(call);
	if (path !== null) return `path:${path}`;
	return call.id === undefined ? `index:${index}` : `id:${call.id}`;
}

/**
 * A call the user rejected or interrupted has no outcome: upstream counts it in
 * its segment but adds no "(N failed)" for it.
 */
function callOutcome(call: ToolCallLike, failedLaunches: ReadonlySet<string>): CallOutcome | undefined {
	if (call.stopped === true || call.denied === true) return undefined;
	const failedLaunch = call.id !== undefined && failedLaunches.has(call.id);
	return call.isError === true || failedLaunch ? "failed" : "succeeded";
}

function countFailed(byKey: Map<string, CallOutcome | undefined>): number {
	let failed = 0;
	for (const outcome of byKey.values()) if (outcome === "failed") failed++;
	return failed;
}

/**
 * A segment before its failure suffix, with the actions it stands for -- files,
 * calls, or verbs -- so a capped header can total the ones it drops.
 */
interface CountedSegment extends SummarySegment {
	count: number;
	failed: number;
}

function withFailures({verb, rest, failed}: CountedSegment): SummarySegment {
	return failed === 0 ? {verb, rest} : {verb, rest: `${rest} (${failed} failed)`};
}

/**
 * One segment for every file call when they all touched one file: the verbs in
 * the order first used, then its name -- "Read, edited, and created x.ts" --
 * with one failure per verb that failed.
 */
function soleFileSegment(
	path: string,
	outcomes: Map<ToolCategory, Map<string, CallOutcome | undefined>>,
): CountedSegment {
	const failedByVerb = new Map<string, boolean>();
	for (const [cat, byKey] of outcomes) {
		if (!FILE_CATEGORIES.has(cat)) continue;
		const verb = CATEGORY_LABELS[cat].verb.toLowerCase();
		failedByVerb.set(verb, failedByVerb.get(verb) === true || countFailed(byKey) > 0);
	}
	const verbs = VERB_LIST.format(failedByVerb.keys());
	return {
		verb: verbs.charAt(0).toUpperCase() + verbs.slice(1),
		rest: basenameFromPath(path),
		count: failedByVerb.size,
		failed: [...failedByVerb.values()].filter(Boolean).length,
	};
}

function labelledSegment(label: SegmentLabel, count: number, failed: number): CountedSegment {
	return {verb: label.verb, rest: pluralize(count, label.one, label.many), count, failed};
}

/** Segments upstream shows before folding the rest into "and N more actions". */
const SHOWN_SEGMENTS = 3;

/**
 * Five or more segments keep the first three and total the rest: "Ran a
 * command, browsed the web, fetched 4 pages, and 2 more actions". Four still
 * show in full, as folding one would save nothing.
 */
function capSegments(segments: CountedSegment[]): CountedSegment[] {
	if (segments.length < SHOWN_SEGMENTS + 2) return segments;
	const dropped = segments.slice(SHOWN_SEGMENTS);
	const count = dropped.reduce((sum, segment) => sum + segment.count, 0);
	const failed = dropped.reduce((sum, segment) => sum + segment.failed, 0);
	const more: CountedSegment = {
		verb: "and",
		rest: pluralize(count, "1 more action", "{n} more actions"),
		count,
		failed,
	};
	return [...segments.slice(0, SHOWN_SEGMENTS), more];
}

/**
 * Upstream fails a launch in this group whose background task failed, "Ran 2
 * commands (1 failed), finished a background command", and settles as many
 * failed completions in the group, whichever launch each one reports, so they
 * stop leading the label.
 */
function attributeLaunchFailures(
	calls: ToolCallLike[],
	completions: readonly BackgroundCompletionLike[],
	failedLaunches: ReadonlySet<string>,
): {completions: BackgroundCompletionLike[]; failedLaunches: ReadonlySet<string>} {
	const callIds = new Set(calls.flatMap((call) => (call.id === undefined ? [] : [call.id])));
	const launches = new Set(failedLaunches);
	for (const {status, toolUseId} of completions) {
		if (status === "failed" && toolUseId != null && callIds.has(toolUseId)) launches.add(toolUseId);
	}
	let toSettle = calls.filter(
		(call) => call.isError !== true && call.id !== undefined && launches.has(call.id),
	).length;
	const settled = completions.map((completion) => {
		if (completion.status !== "failed" || toSettle === 0) return completion;
		toSettle--;
		return {...completion, status: "completed" as const};
	});
	return {completions: settled, failedLaunches: launches};
}

function buildSummarySegments(
	calls: ToolCallLike[],
	groupCompletions: readonly BackgroundCompletionLike[] = [],
	knownFailedLaunches: ReadonlySet<string> = new Set(),
	received: ReceivedMessages = NO_RECEIVED,
): ToolCallSummaryStats {
	const {completions, failedLaunches} = attributeLaunchFailures(calls, groupCompletions, knownFailedLaunches);
	// Insertion order carries the summary order: upstream Normal writes both
	// "Updated todos, read 3 files" and "Read index.ts, updated todos", so
	// segments follow the order each tool was first called.
	const outcomes = new Map<ToolCategory, Map<string, CallOutcome | undefined>>();
	let otherTools = 0;
	let otherFailed = 0;
	let added = 0;
	let removed = 0;

	const categories = categorizeWithWrites(calls);
	calls.forEach((call, index) => {
		const cat = categories[index] ?? null;
		const outcome = callOutcome(call, failedLaunches);
		if (cat === null) {
			otherTools++;
			if (outcome === "failed") otherFailed++;
			return;
		}
		let byKey = outcomes.get(cat);
		if (byKey === undefined) {
			byKey = new Map();
			outcomes.set(cat, byKey);
		}
		const key = callKey(call, index);
		byKey.set(key, outcome ?? byKey.get(key));
		// A failed edit changed nothing, so upstream leaves it out of the totals.
		if (isMutation(cat) && call.isError !== true) {
			const s = diffStatsForCall(call);
			added += s.added;
			removed += s.removed;
		}
	});

	let failed = otherFailed;
	for (const byKey of outcomes.values()) failed += countFailed(byKey);

	// Each segment reports its own failures: "Edited k.ts (1 failed), ran a command".
	const segments: CountedSegment[] = [];
	const solePath = soleFilePath(calls, categories);
	let soleFileNamed = false;
	for (const [cat, byKey] of outcomes) {
		if (solePath !== null && FILE_CATEGORIES.has(cat)) {
			if (!soleFileNamed) segments.push(soleFileSegment(solePath, outcomes));
			soleFileNamed = true;
			continue;
		}
		segments.push(labelledSegment(CATEGORY_LABELS[cat], byKey.size, countFailed(byKey)));
	}

	if (otherTools > 0) segments.push(labelledSegment(OTHER_TOOLS_LABEL, otherTools, otherFailed));

	// Upstream names agent messages where they arrived: "Received a message, ran
	// a command" when they led the run, "Ran 2 commands, received a message" after.
	if (received.leading > 0) segments.unshift(labelledSegment(RECEIVED_LABEL, received.leading, 0));
	if (received.trailing > 0) segments.push(labelledSegment(RECEIVED_LABEL, received.trailing, 0));
	// Upstream leads with the re-prompt that started the run: "Hook re-prompted Claude, ran a command".
	if (received.reprompted === true) segments.unshift({verb: "Hook", rest: "re-prompted Claude", count: 1, failed: 0});

	// Upstream folds background completions in last: "Ran a command, finished
	// a background command", "Used a tool, finished a background task (1 stopped)",
	// but leads with them when one failed: "Finished a background command (1 failed),
	// ran a command". A group mixing failed and stopped completions is unobserved.
	if (completions.length > 0) {
		const noun = completions.every((completion) => completion.command) ? "command" : "task";
		const stopped = completions.filter((completion) => completion.status === "stopped").length;
		const failedCompletions = completions.filter((completion) => completion.status === "failed").length;
		const rest = pluralize(completions.length, `a background ${noun}`, `{n} background ${noun}s`);
		const count = completions.length;
		if (failedCompletions > 0) {
			segments.unshift({verb: "Finished", rest, count, failed: failedCompletions});
		} else {
			segments.push({
				verb: "Finished",
				rest: stopped > 0 ? `${rest} (${stopped} stopped)` : rest,
				count,
				failed: 0,
			});
		}
	}

	// Upstream capitalizes only the leading verb: "Ran 2 commands, read cache.ts".
	return {
		segments: capSegments(segments)
			.map(withFailures)
			.map((segment, i) => (i === 0 ? segment : {verb: lowercaseFirst(segment.verb), rest: segment.rest})),
		added,
		removed,
		failed,
	};
}

/**
 * `failedLaunches` holds the tool_use ids of background launches whose task
 * later failed, wherever its notification landed; upstream counts each as a
 * failed call.
 */
export function summarizeToolCallStats(
	calls: ToolCallLike[],
	completions: readonly BackgroundCompletionLike[] = [],
	failedLaunches: ReadonlySet<string> = new Set(),
	received: ReceivedMessages = NO_RECEIVED,
): ToolCallSummaryStats {
	return buildSummarySegments(calls, completions, failedLaunches, received);
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
