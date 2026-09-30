import {z} from "zod";
import type {SessionGroupRow} from "./session-groups";

/** Upstream claude.ai/code home "Sessions" action-center kinds: Needs input, Ready for review. */
export const HomeAttentionKindSchema = z.enum(["blocked", "review"]);
export type HomeAttentionKind = z.infer<typeof HomeAttentionKindSchema>;

export interface HomeAttentionRow extends SessionGroupRow {
	/** A pending approval (plan, question or permission prompt) from the session or its subagents. */
	pendingApproval: {toolName: string} | null;
	/** The session's generated or indexed summary, for the hover preview card. */
	summary: string | null;
	/** Hook or herdr status detail, e.g. the running task summary. */
	statusDetail: string | null;
	lastAssistantText: string | null;
}

export interface HomeAttentionInput<Row extends HomeAttentionRow> {
	rows: readonly Row[];
	pinnedIds: ReadonlySet<string>;
	/** Session id to the time it was dismissed; the row returns once it has newer activity. */
	dismissed: Readonly<Record<string, number>>;
	now: number;
}

export interface HomeAttentionItem<Row extends HomeAttentionRow> {
	session: Row;
	kind: HomeAttentionKind;
	statusLine: string | null;
}

const KIND_ORDER = {
	blocked: 0,
	review: 1,
} as const satisfies Record<HomeAttentionKind, number>;

function firstNonBlankLine(text: string | null): string | null {
	if (text === null) return null;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed) return trimmed;
	}
	return null;
}

/** Pending approval, else hook/herdr status detail, else the last assistant message's first line. */
export function attentionStatusLine(row: HomeAttentionRow): string | null {
	if (row.pendingApproval) return `Waiting on permission: ${row.pendingApproval.toolName}`;
	return firstNonBlankLine(row.statusDetail) ?? firstNonBlankLine(row.lastAssistantText);
}

function isDismissed(row: HomeAttentionRow, dismissed: Readonly<Record<string, number>>): boolean {
	const dismissedAt = dismissed[row.sessionId];
	return dismissedAt !== undefined && dismissedAt >= row.lastActivityAt;
}

/**
 * The home page action center: only Needs input and Ready for review sessions
 * that are not pinned, archived or dismissed, blocked first, each by last
 * activity descending.
 */
export function selectHomeAttention<Row extends HomeAttentionRow>({
	rows,
	pinnedIds,
	dismissed,
}: HomeAttentionInput<Row>): HomeAttentionItem<Row>[] {
	const items: HomeAttentionItem<Row>[] = [];
	for (const session of rows) {
		const kind = session.bucket;
		if (kind !== "blocked" && kind !== "review") continue;
		if (session.archived || pinnedIds.has(session.sessionId)) continue;
		if (isDismissed(session, dismissed)) continue;
		items.push({session, kind, statusLine: attentionStatusLine(session)});
	}
	return items.sort(
		(first, second) =>
			KIND_ORDER[first.kind] - KIND_ORDER[second.kind] ||
			second.session.lastActivityAt - first.session.lastActivityAt,
	);
}
