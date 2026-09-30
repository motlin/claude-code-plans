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
	/** The line the card follows: the turn's last assistant text, else its last assistant line. */
	anchorLineIndex: number;
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
 * Sum Edit/Write/MultiEdit/NotebookEdit diff stats per file. Failed calls
 * changed nothing and are skipped; every other tool is ignored.
 */
export function aggregateTurnEdits(calls: readonly ToolCallLike[]): TurnChangesSummary {
	const files = new Map<string, TurnFileChange>();
	for (const call of calls) {
		if (call.isError === true) continue;
		const path = editedFile(call);
		if (path === null) continue;
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

function hasText(line: SessionLine): boolean {
	if (line.type !== "assistant") return false;
	const content = line.message?.content;
	if (typeof content === "string") return content.trim() !== "";
	return (content ?? []).some((block) => block.type === "text" && block.text.trim() !== "");
}

interface TurnAccumulator {
	uuid: string | undefined;
	calls: ToolCallLike[];
	lastAssistant: number | undefined;
	lastText: number | undefined;
}

/**
 * Split the transcript into prompt-to-prompt turns and summarize each turn's
 * file edits, keyed by the line index its card follows. Turns that edited
 * nothing are left out.
 */
export function collectTurnChanges(
	lines: readonly SessionLine[],
	toolResultMap: ReadonlyMap<string, ToolResultInfo>,
): Map<number, TurnChanges> {
	const result = new Map<number, TurnChanges>();
	let turn: TurnAccumulator = {
		uuid: undefined,
		calls: [],
		lastAssistant: undefined,
		lastText: undefined,
	};

	const finish = () => {
		const anchor = turn.lastText ?? turn.lastAssistant;
		if (anchor === undefined || turn.uuid === undefined) return;
		const summary = aggregateTurnEdits(turn.calls);
		if (summary.files.length === 0) return;
		result.set(anchor, {turnUuid: turn.uuid, anchorLineIndex: anchor, ...summary});
	};

	for (const line of lines) {
		if (isTurnStartLine(line)) {
			finish();
			turn = {uuid: undefined, calls: [], lastAssistant: undefined, lastText: undefined};
		}
		if (line.type !== "user" && line.type !== "assistant") continue;
		turn.uuid ??= line.uuid;
		if (line.type !== "assistant") continue;
		turn.lastAssistant = line.lineIndex;
		if (hasText(line)) turn.lastText = line.lineIndex;
		const content = line.message?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (block.type !== "tool_use") continue;
			turn.calls.push({
				name: block.name,
				input: block.input,
				isError: toolResultMap.get(block.id)?.isError,
			});
		}
	}
	finish();
	return result;
}
