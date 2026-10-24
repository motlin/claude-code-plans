import type {ToolResultInfo} from "./sessions";
import {diffStatsForCall, type ToolCallLike} from "./session-utils";
import type {SessionLine} from "./transcript";

/** One file's summed diff stats across a turn's edit calls. */
export interface TurnFileChange {
	path: string;
	added: number;
	removed: number;
}

export interface TurnChangesSummary {
	/** In the order the turn first touched each file. */
	files: TurnFileChange[];
	added: number;
	removed: number;
}

/** A turn's edits, plus where the transcript shows its end-of-turn card. */
export interface TurnChanges extends TurnChangesSummary {
	/** A uuid inside the turn, for the Changes pane's `turn:<uuid>` scope. */
	turnUuid: string;
	/** The line the card follows: the turn's last visible assistant row, else its last assistant line. */
	anchorLineIndex: number;
}

/** A turn call, which counts only once its result is in (`hasResult` false skips it). */
export interface TurnEditCall extends ToolCallLike {
	hasResult?: boolean | undefined;
}

const SCRATCHPAD_TAIL = String.raw`[A-Za-z0-9-]+/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/scratchpad(?:/|$)`;
const POSIX_SCRATCHPAD = new RegExp(String.raw`^(?:/private)?/tmp/claude-\d+/` + SCRATCHPAD_TAIL);
const WINDOWS_SCRATCHPAD = new RegExp(
	String.raw`^[A-Z]:/Users/[^/]+/AppData/Local/Temp/claude/` + SCRATCHPAD_TAIL,
	"i",
);
const MEMORY_PATH = /\/\.claude\/projects\/[^/]+\/memory\//;

function hasDotSegment(path: string): boolean {
	return path.split("/").some((segment) => segment === "." || segment === "..");
}

/** Upstream `$M`: a path inside a Claude Code session scratchpad. Paths with `.`/`..` segments never match. */
export function isScratchpadPath(path: string): boolean {
	const normalized = path.replaceAll("\\", "/");
	if (hasDotSegment(normalized)) return false;
	return POSIX_SCRATCHPAD.test(normalized) || WINDOWS_SCRATCHPAD.test(normalized);
}

function isMemoryPath(path: string): boolean {
	return MEMORY_PATH.test(path.replaceAll("\\", "/"));
}

function lineCount(text: string): number {
	return text === "" ? 0 : text.split("\n").length;
}

function editedFile(call: ToolCallLike): string | null {
	const key =
		call.name === "NotebookEdit"
			? "notebook_path"
			: call.name === "Edit" || call.name === "MultiEdit" || call.name === "Write"
				? "file_path"
				: null;
	if (key === null) return null;
	const path = call.input[key];
	return typeof path === "string" && path !== "" ? path : null;
}

function callStats(call: ToolCallLike): {added: number; removed: number} {
	if (call.name !== "NotebookEdit") return diffStatsForCall(call);
	if (call.input["edit_mode"] === "delete") return {added: 0, removed: 0};
	const source = call.input["new_source"];
	return {added: typeof source === "string" ? lineCount(source) : 0, removed: 0};
}

/**
 * Sum Edit/Write/MultiEdit/NotebookEdit diff stats per file, counting what
 * upstream `tye` counts: failed and still-pending calls are skipped, as are
 * scratchpad and memory-dir paths; every other tool is ignored.
 */
export function aggregateTurnEdits(calls: readonly TurnEditCall[]): TurnChangesSummary {
	const files = new Map<string, TurnFileChange>();
	for (const call of calls) {
		if (call.isError === true || call.hasResult === false) continue;
		const path = editedFile(call);
		if (path === null || isScratchpadPath(path) || isMemoryPath(path)) continue;
		const stats = callStats(call);
		const file = files.get(path) ?? {path, added: 0, removed: 0};
		file.added += stats.added;
		file.removed += stats.removed;
		files.set(path, file);
	}
	const list = [...files.values()];
	return {
		files: list,
		added: list.reduce((sum, file) => sum + file.added, 0),
		removed: list.reduce((sum, file) => sum + file.removed, 0),
	};
}

/** A user line the person typed, which starts a turn (mirrors the diff handler's rule). */
function isTurnStartLine(line: SessionLine): boolean {
	if (line.type !== "user" || line.isMeta === true || line.isCompactSummary === true) return false;
	const content = line.message?.content;
	if (content === undefined || typeof content === "string") return true;
	return !content.some((block) => block.type === "tool_result");
}

/** An assistant line that draws a row: prose, or a tool call when tools are shown. */
function drawsRow(line: SessionLine, showTools: boolean): boolean {
	if (line.type !== "assistant") return false;
	const content = line.message?.content;
	if (typeof content === "string") return content.trim() !== "";
	return (content ?? []).some(
		(block) => (block.type === "text" && block.text.trim() !== "") || (showTools && block.type === "tool_use"),
	);
}

interface TurnAccumulator {
	uuid: string | undefined;
	calls: TurnEditCall[];
	lastAssistant: number | undefined;
	lastRow: number | undefined;
}

/**
 * Split the transcript into prompt-to-prompt turns and summarize each turn's
 * file edits, keyed by the line index its card follows: the turn's last row,
 * as upstream draws the card after a turn's final tool row as readily as after
 * its prose. Turns that edited nothing are left out.
 */
export function collectTurnChanges(
	lines: readonly SessionLine[],
	toolResultMap: ReadonlyMap<string, ToolResultInfo>,
	showTools = true,
): Map<number, TurnChanges> {
	const result = new Map<number, TurnChanges>();
	let turn: TurnAccumulator = {
		uuid: undefined,
		calls: [],
		lastAssistant: undefined,
		lastRow: undefined,
	};

	const finish = () => {
		const anchor = turn.lastRow ?? turn.lastAssistant;
		if (anchor === undefined || turn.uuid === undefined) return;
		const summary = aggregateTurnEdits(turn.calls);
		if (summary.files.length === 0) return;
		result.set(anchor, {turnUuid: turn.uuid, anchorLineIndex: anchor, ...summary});
	};

	for (const line of lines) {
		if (isTurnStartLine(line)) {
			finish();
			turn = {uuid: undefined, calls: [], lastAssistant: undefined, lastRow: undefined};
		}
		if (line.type !== "user" && line.type !== "assistant") continue;
		turn.uuid ??= line.uuid;
		if (line.type !== "assistant") continue;
		turn.lastAssistant = line.lineIndex;
		if (drawsRow(line, showTools)) turn.lastRow = line.lineIndex;
		const content = line.message?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (block.type !== "tool_use") continue;
			const result = toolResultMap.get(block.id);
			turn.calls.push({
				name: block.name,
				input: block.input,
				isError: result?.isError,
				resultMeta: result?.resultMeta,
				hasResult: result !== undefined,
			});
		}
	}
	finish();
	return result;
}
