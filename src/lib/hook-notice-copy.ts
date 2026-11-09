/*
 * Upstream's "Claude Code notice" line copy (renderer c01e7498d `m_`): a string notice reads as itself,
 * a structured one is worded per notice kind.
 */
import {assertNever} from "./assert-never";
import type {HookNotice, HookNoticeMessage} from "./transcript";

function plural(n: number, one: string, other: string): string {
	return n === 1 ? `1 ${one}` : `${n} ${other}`;
}

export function hookNoticeText(message: HookNoticeMessage): string {
	if (typeof message === "string") return message;
	switch (message.notice) {
		case "away_summary":
			return `Recap: ${message.recap}`;
		case "agents_killed":
			return "All background agents stopped";
		case "memory_saved": {
			const parts: string[] = [];
			if (message.count > 0) parts.push(plural(message.count, "memory", "memories"));
			if (message.teamCount > 0) parts.push(plural(message.teamCount, "team memory", "team memories"));
			const saved = parts.join(" · ");
			return message.verb === undefined ? `Saved ${saved}` : `${message.verb} ${saved}`;
		}
		default:
			return assertNever(message);
	}
}

/**
 * Whether a "Claude Code notice" line may roll up into the tool run before it (upstream
 * `eu["notice-without-warning-or-recap"]`): every notice is notice-level and none is a recap (`$l`).
 */
export function foldsIntoToolRun(notices: readonly HookNotice[]): boolean {
	return notices.every(
		(notice) =>
			notice.level === "notice" &&
			!(typeof notice.message === "object" && notice.message.notice === "away_summary"),
	);
}
