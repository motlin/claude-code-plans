/**
 * Upstream's tool-run model (claude.ai/code `RO`/`UO` classifier, `CF` splitter, `OF` bare test).
 *
 * The consecutive tool calls between two prose blocks are cut into runs. A "stands-alone" call
 * is always its own run; consecutive default calls join one run. A run renders as a bare row
 * when every call in it targets the same file with the same verb.
 */

// TODO: upstream also has own-run buckets (`suggested_task` for spawn_task/start_session and
// `parasol_call`), which split at task events. No local producer exists yet.
export type ToolBucket = "default" | "standalone";

export interface RunCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
	result?: string | undefined;
	isError?: boolean | undefined;
	pending?: boolean | undefined;
	hasTaskEvents?: boolean | undefined;
	precedingThinking?: boolean | undefined;
}

const STANDALONE_TOOL_NAMES: ReadonlySet<string> = new Set([
	"AskUserQuestion",
	"ExitPlanMode",
	"SendUserMessage",
	"SendUserFile",
	"Workflow",
	"ReportFindings",
	"ClaudeDesign",
	"mcp__ccd_turn__wrap_up",
]);

const ARTIFACT_SURFACE_ACTIONS: ReadonlySet<unknown> = new Set([undefined, "publish", "edit", "open"]);

const NOT_SENT = /not sent/i;

export function toolBucket(call: Pick<RunCall, "name" | "input" | "result" | "isError" | "pending">): ToolBucket {
	if (STANDALONE_TOOL_NAMES.has(call.name)) return "standalone";
	if (call.name === "Artifact") {
		const surface = Object.keys(call.input).length > 0 && ARTIFACT_SURFACE_ACTIONS.has(call.input["action"]);
		return surface ? "standalone" : "default";
	}
	if (call.name === "PushNotification") {
		const sent = call.pending !== true && call.isError !== true && !NOT_SENT.test(call.result ?? "");
		return sent ? "default" : "standalone";
	}
	return "default";
}

const FILE_VERBS: Readonly<Record<string, string>> = {
	Read: "Read",
	Write: "Write",
	Edit: "Edit",
	MultiEdit: "Edit",
	NotebookEdit: "NotebookEdit",
};

/** Upstream `S`: `<verb> <path>`, with NotebookEdit's verb carrying its edit_mode (default "replace"). */
export function targetKey(call: Pick<RunCall, "name" | "input">): string | null {
	const baseVerb = FILE_VERBS[call.name];
	if (baseVerb === undefined) return null;
	const mode = call.input["edit_mode"];
	const verb = call.name === "NotebookEdit" ? `${baseVerb} ${typeof mode === "string" ? mode : "replace"}` : baseVerb;
	const path = call.input["file_path"] ?? call.input["notebook_path"];
	return typeof path === "string" ? `${verb} ${path}` : null;
}

export function rendersBare(calls: readonly RunCall[], options: {showThinking: boolean}): boolean {
	const first = calls[0];
	if (first === undefined) return false;
	const key = targetKey(first);
	if (key === null) return false;
	return calls.every(
		(c, index) =>
			targetKey(c) === key &&
			c.hasTaskEvents !== true &&
			!(options.showThinking && index > 0 && c.precedingThinking === true),
	);
}

export function splitRuns<T extends RunCall>(calls: readonly T[]): T[][] {
	const runs: T[][] = [];
	let previousJoinable = false;
	for (const c of calls) {
		const joinable = toolBucket(c) === "default";
		const last = runs.at(-1);
		if (joinable && previousJoinable && last !== undefined) last.push(c);
		else runs.push([c]);
		previousJoinable = joinable;
	}
	return runs;
}

/** Upstream `w`: one call, or every call on one file with one verb. */
export function sameTarget(calls: readonly Pick<RunCall, "name" | "input">[]): boolean {
	const first = calls[0];
	if (first === undefined) return false;
	if (calls.length === 1) return true;
	const key = targetKey(first);
	return key !== null && calls.every((c) => targetKey(c) === key);
}

/** A stretch of 2+ consecutive same-target calls, drawn as one step. */
export interface SameTargetRun<T> {
	kind: "run";
	key: string;
	members: T[];
}

/**
 * Upstream `LQ`: folds each maximal stretch of 2+ consecutive calls with one
 * target into a run. Shown thinking before a call (`precedingThinking`, set by
 * callers only when thinking is shown) or task events after one break a stretch.
 */
export function coalesceSameTarget<T extends RunCall>(calls: readonly T[]): (T | SameTargetRun<T>)[] {
	const stretches: T[][] = [];
	let previousKey: string | null = null;
	for (const c of calls) {
		const key = targetKey(c);
		const last = stretches.at(-1);
		const joins =
			last !== undefined &&
			key !== null &&
			key === previousKey &&
			c.precedingThinking !== true &&
			last.at(-1)?.hasTaskEvents !== true;
		if (joins) last.push(c);
		else stretches.push([c]);
		previousKey = key;
	}
	const items: (T | SameTargetRun<T>)[] = [];
	for (const stretch of stretches) {
		const [first, ...rest] = stretch;
		if (first === undefined) continue;
		const key = targetKey(first);
		items.push(rest.length > 0 && key !== null ? {kind: "run", key, members: stretch} : first);
	}
	return items;
}

/**
 * A Read bound (`offset`/`limit`) as a positive integer. Claude Code has
 * written these as strings on disk (`"offset": "55, "`), so parse rather than
 * cast, and treat anything non-positive as absent.
 */
function readBound(value: unknown): number | null {
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
	if (!Number.isFinite(parsed) || parsed < 1) return null;
	return Math.trunc(parsed);
}

/** The lines a Read result reports it returned, from its `toolUseResult.file`. */
export interface ReadFileLines {
	filePath: string;
	startLine: number;
	numLines: number;
	totalLines?: number | undefined;
	/** The returned content ends in a newline, which the CLI counts as one more line. */
	endsWithNewline: boolean;
}

export interface RunSuffixCall {
	name: string;
	input: Record<string, unknown>;
	readFile?: ReadFileLines | undefined;
}

/** Upstream `v`: a partial Read's line range, or null for a whole-file read. */
function readRange(call: RunSuffixCall): string | null {
	const offset = readBound(call.input["offset"]);
	const limit = readBound(call.input["limit"]);
	if (offset === null && limit === null) return null;
	const file = call.readFile;
	if (file !== undefined && file.filePath === call.input["file_path"] && file.numLines > 0) {
		const start = Math.max(file.startLine, 1);
		const end = start + file.numLines - 1;
		const shown = file.numLines > 1 && file.endsWithNewline && end === file.totalLines ? end - 1 : end;
		return `${start}–${shown}`;
	}
	const start = offset ?? 1;
	return limit === null ? `${start}–` : `${start}–${start + limit - 1}`;
}

/**
 * Upstream `_`: the suffix a run's row trails with: `×N` for 2+ NotebookEdit
 * inserts or deletes, the ranges of Reads that each read a range, else none.
 */
export function runSuffix(calls: readonly RunSuffixCall[]): string | undefined {
	const first = calls[0];
	if (first === undefined) return undefined;
	if (first.name === "NotebookEdit") {
		const mode = first.input["edit_mode"];
		return (mode === "insert" || mode === "delete") && calls.length > 1 ? `×${calls.length}` : undefined;
	}
	if (first.name !== "Read") return undefined;
	const ranges = calls.map(readRange);
	if (ranges.some((range) => range === null)) return undefined;
	return `(${ranges.join(", ")})`;
}
