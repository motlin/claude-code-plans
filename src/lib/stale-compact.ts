/**
 * The stale-session compact advisory: the counterpart of upstream's gate constants `_a` and test `ba`
 * (claude.ai/code c1958b152), the hook `nke` (cc43287c9) and the age format `xTe` (cbb2d9547), crawl
 * 2026-11-06. Once a session has sat idle past the prompt cache's life with a large context, the next
 * message re-reads all of it, so a one-line footnote under the last reply offers to compact first.
 * Local has no experiment, so it always takes upstream's treatment arm: the 300k absolute floor and
 * the tokens-in-line copy.
 */
import {formatTokenCount} from "./composer-state";
import type {SessionLine} from "./transcript";

/** Upstream `_a`. */
export const STALE_COMPACT = {minAgeMinutes: 70, minContextPct: 75, minContextTokens: 300_000} as const;

/** Upstream `va().floor` with the flag on and no opt-out: local always runs the treatment arm. */
export const STALE_COMPACT_FLOOR: number | null = STALE_COMPACT.minContextTokens;

const MIN_AGE_MS = STALE_COMPACT.minAgeMinutes * 60_000;

/** Upstream `ba`: a share of the window, or the absolute token floor when one is set. */
export function staleCompactQualifies(
	tokens: number,
	window: number,
	{minPct, minTokens}: {minPct: number; minTokens: number | null},
): boolean {
	return tokens * 100 >= minPct * window || (minTokens !== null && tokens >= minTokens);
}

/** Upstream `xTe` through `cj` with `unitDisplay: "narrow"`: whole hours, or whole days from 1440 minutes. */
export function formatStaleAge(minutes: number): string {
	const days = minutes >= 1440;
	const value = days ? Math.floor(minutes / 1440) : Math.floor(minutes / 60);
	return new Intl.NumberFormat("en-US", {style: "unit", unit: days ? "day" : "hour", unitDisplay: "narrow"}).format(
		value,
	);
}

/** Upstream's English `defaultMessage`s (`tp9gn+`, `HCF15U`, `yLDFpU`, `vY7VTc`, `JEeNJA`, `BUhITA`). */
export const STALE_COMPACT_COPY = {
	tokensLine:
		"Your next message re-reads all {tokens} tokens. Compact first so later messages start from a short summary.",
	genericLine: "Compacting before your next message keeps later replies fast and lighter on your usage.",
	why: "After {age} idle, the cache has expired, so your next message re-reads all {tokens} tokens. Compact first so later replies run on a short summary instead.",
	whyLabel: "Why compact now",
	compact: "Compact session",
	compacting: "Compacting…",
} as const;

/** The band's sentence: tokens in line on the treatment arm, the generic line otherwise. */
export function staleCompactLine({
	tokensInLine,
	contextTokens,
}: {
	tokensInLine: boolean;
	contextTokens: number;
}): string {
	return tokensInLine
		? STALE_COMPACT_COPY.tokensLine.replace("{tokens}", formatTokenCount(contextTokens))
		: STALE_COMPACT_COPY.genericLine;
}

/** The "Why compact now" popover body. */
export function staleCompactWhy({ageMinutes, contextTokens}: {ageMinutes: number; contextTokens: number}): string {
	return STALE_COMPACT_COPY.why
		.replace("{age}", formatStaleAge(ageMinutes))
		.replace("{tokens}", formatTokenCount(contextTokens));
}

export interface StaleCompactAdvisory {
	readonly anchor: number;
	readonly ageMinutes: number;
	readonly contextTokens: number;
	readonly tokensInLine: boolean;
}

export interface StaleCompactInput {
	readonly nowMs: number;
	readonly anchorMs: number;
	readonly contextTokens: number | null;
	readonly contextWindow: number | null;
	readonly floor: number | null;
	/** Upstream `ge`: reachable, idle, not held, and the turn-tail slot is free. */
	readonly eligible: boolean;
}

/** Upstream `nke`'s advisory `_e`, less the experiment, prefs and sleep-interruption gates. */
export function decideStaleCompact(input: StaleCompactInput): StaleCompactAdvisory | null {
	const {contextTokens, contextWindow, floor} = input;
	if (!input.eligible || contextTokens === null || contextWindow === null || contextWindow <= 0) return null;
	const ageMs = input.nowMs - input.anchorMs;
	if (ageMs < MIN_AGE_MS) return null;
	if (!staleCompactQualifies(contextTokens, contextWindow, {minPct: STALE_COMPACT.minContextPct, minTokens: floor}))
		return null;
	return {anchor: input.anchorMs, ageMinutes: ageMs / 60_000, contextTokens, tokensInLine: floor !== null};
}

/** Upstream `Xu`'s `staleCompactSlot`, with no urgent notice or auto-archive hold locally. */
export function staleCompactSlot({lastEntryIsAssistant}: {lastEntryIsAssistant: boolean}): boolean {
	return lastEntryIsAssistant;
}

function isTranscriptEntry(line: SessionLine): boolean {
	return line.type === "assistant" || (line.type === "user" && line.isMeta !== true);
}

/**
 * The transcript's last user or assistant entry, when it is a real assistant reply: upstream's
 * `lastEntryIsAssistant`, where a synthetic (API error) entry doesn't count. Returns that line.
 */
export function lastAssistantReplyEntry(lines: readonly SessionLine[]): SessionLine | null {
	const last = lines.findLast(isTranscriptEntry);
	return last?.type === "assistant" && last.isApiErrorMessage !== true ? last : null;
}

export function lastEntryIsAssistantReply(lines: readonly SessionLine[]): boolean {
	return lastAssistantReplyEntry(lines) !== null;
}
