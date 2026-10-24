/**
 * The Rewind picker's pure parts, copied from claude.ai/code's `rce` picker
 * and `E_` open gate (see .llm/upstream-sync/features/rewind-undo-redo.md).
 */

import {stripCommandTags} from "./session-utils";
import {isPrompt, promptText} from "./transcript-chain";

/** One prompt the picker offers to rewind to. */
export interface RewindTurn {
	uuid: string;
	/** The prompt as the CLI's selector draws it; checked against the selected row before Enter. */
	text: string;
}

/** Upstream's `wp`: a second Escape within this window opens the picker. */
export const REWIND_ESC_WINDOW_MS = 500;
/** Upstream's `E_`: the picker refuses to reopen this soon after closing. */
const REWIND_REOPEN_GUARD_MS = 600;
/** Upstream's `Cte` cut: a longer prompt shows its first 80 characters and "…". */
const REWIND_LABEL_LIMIT = 80;

const COMMAND_NAME = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;

/** A slash command record as the CLI shows it ("/model opus"); otherwise the prompt without harness tags. */
function turnText(raw: string): string {
	const name = COMMAND_NAME.exec(raw)?.[1];
	if (name === undefined) return stripCommandTags(raw);
	const args = COMMAND_ARGS.exec(raw)?.[1]?.trim() ?? "";
	return args === "" ? `/${name}` : `/${name} ${args}`;
}

/** The active chain's user prompts with text, oldest first, as the picker lists them. */
export function rewindTurns(records: readonly Record<string, unknown>[], hidden: ReadonlySet<string>): RewindTurn[] {
	return records.flatMap((record) => {
		const uuid = record["uuid"];
		if (typeof uuid !== "string" || hidden.has(uuid)) return [];
		if (record["isSidechain"] === true || record["isCompactSummary"] === true || !isPrompt(record)) return [];
		const text = turnText(promptText(record) ?? "");
		return text === "" ? [] : [{uuid, text}];
	});
}

/** Upstream's `Cte`: the row label, pre-truncated before CSS `truncate`. */
export function rewindLabel(text: string): string {
	return text.length > REWIND_LABEL_LIMIT ? `${text.slice(0, REWIND_LABEL_LIMIT)}…` : text;
}

/** Up presses from the CLI selector's "(current)" row to the turn (1 is the newest), or null when it isn't listed. */
export function rewindStepsBack(turns: readonly RewindTurn[], uuid: string): number | null {
	const index = turns.findIndex((turn) => turn.uuid === uuid);
	return index === -1 ? null : turns.length - index;
}

/**
 * Upstream's `E_`: refuse when rewind is unavailable, the session is busy, the
 * composer holds any non-whitespace text, or the picker closed under
 * {@link REWIND_REOPEN_GUARD_MS} ago.
 */
export function canOpenRewindPicker({
	available,
	busy,
	draft,
	now,
	closedAt,
}: {
	available: boolean;
	busy: boolean;
	draft: string;
	now: number;
	closedAt: number | null;
}): boolean {
	if (!available || busy || draft.trim() !== "") return false;
	return closedAt === null || now - closedAt >= REWIND_REOPEN_GUARD_MS;
}
