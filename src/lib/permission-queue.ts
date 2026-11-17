import {findMainToolUses, jsonEqual} from "./approval-dock";
import type {PermissionAskEntry} from "./permission-ask";

/**
 * Which open ask the CLI's dialog shows. Upstream sorts its requests oldest first; the scratch-CLI capture that would
 * pin the CLI's own order is still pending (see `.llm/upstream-sync/features/parallel-pending-tool-use-count.md`
 * task 4).
 */
export const PERMISSION_HEAD: "oldest" | "newest" = "oldest";

/** What a resolving hook (`PostToolUse`, `PostToolUseFailure`, `PermissionDenied`) says about its call. */
export type PermissionAskMatch = Pick<PermissionAskEntry, "toolName" | "toolInput" | "agentId">;

function sameAsk(ask: PermissionAskMatch, match: PermissionAskMatch): boolean
{
	return (
		ask.toolName === match.toolName && ask.agentId === match.agentId && jsonEqual(ask.toolInput, match.toolInput)
	);
}

/** The asks with a new one appended, unless the same call's ask is still open. */
export function withPermissionAsk<T extends PermissionAskEntry>(asks: readonly T[], ask: T): T[]
{
	return asks.some((open) => sameAsk(open, ask)) ? [...asks] : [...asks, ask];
}

/** The asks without the first one the resolving hook describes. */
export function withoutPermissionAsk<T extends PermissionAskEntry>(asks: readonly T[], match: PermissionAskMatch): T[]
{
	const index = asks.findIndex((ask) => sameAsk(ask, match));
	return index === -1 ? [...asks] : asks.toSpliced(index, 1);
}

/** The ask the CLI's dialog shows, per `PERMISSION_HEAD`. */
export function headPermissionAsk<T extends PermissionAskEntry>(asks: readonly T[]): T | undefined
{
	return PERMISSION_HEAD === "oldest" ? asks[0] : asks.at(-1);
}

export interface PermissionQueue<T extends PermissionAskEntry>
{
	head: T | null;
	queued: T[];
	queueDepth: number;
}

/**
 * The session's live tool-permission asks, head first. A main-thread ask whose call already has a tool_result is
 * gone, which covers a user denial (no hook fires for one); an ask no main-thread call describes (a subagent's, or
 * a call not yet flushed) stays.
 */
export function permissionQueue<T extends PermissionAskEntry>(
	asks: readonly T[],
	records: readonly unknown[],
): PermissionQueue<T>
{
	const uses = findMainToolUses(records);
	const live = asks.filter((ask) =>
	{
		if (ask.agentId !== null) return true;
		const calls = uses.filter((use) => use.call.name === ask.toolName && jsonEqual(use.call.input, ask.toolInput));
		return calls.length === 0 || calls.some((use) => !use.answered);
	});
	const head = headPermissionAsk(live) ?? null;
	return {
		head,
		queued: live.filter((ask) => ask !== head),
		queueDepth: Math.max(0, live.length - 1),
	};
}
