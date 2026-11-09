/**
 * The cold-resume idle cost notice's decision and copy: the counterpart of upstream's idle hook `Wge`,
 * percent `Lge` and copy `k6` (claude.ai/code cc43287c9, crawl 2026-11-06). After two idle hours the
 * prompt cache is cold, so resuming re-reads the whole context; the notice estimates what that costs
 * against the five-hour window. Upstream's server sends `usage.coldResumeQuota`; local has no such
 * feed and uses upstream's preview constants `Bge`.
 */

/** Upstream `72e5`: the idle stretch after which the prompt cache counts as cold. */
export const COLD_RESUME_IDLE_MS = 7_200_000;

export interface ColdResumeQuota {
	readonly percentPerMillionTokens: number;
	readonly minPercent: number;
}

/** Upstream's preview quota `Bge`. */
export const COLD_RESUME_QUOTA: ColdResumeQuota = {percentPerMillionTokens: 40, minPercent: 5};

/**
 * Upstream ships these as compiled intl ids with no default message (heading `1ozh099`, detail
 * `10bu3nc` / `jjr9a3`, actions `10c4epw` / `cx2164` / `1wchwgr`, tips `1mtizas` / `5j44f9`); the
 * English is inferred from the ICU arguments until the live catalog can be read.
 */
export const COLD_RESUME_COPY = {
	heading: "This session has been idle",
	detail: "Idle {idle}. Resuming will use about {percent} of your 5-hour limit.",
	detailUsesRest: "Idle {idle}. Resuming will likely use the rest of your 5-hour limit.",
	resume: "Resume here",
	newSession: "New session",
	newSessionTip: "Mentions this session",
	compact: "Compact",
	compactTip: "Summarize the conversation so far to make resuming cheaper",
} as const;

/** Upstream `Lge`: the rounded share of the five-hour window, or null under the quota's floor. */
export function coldResumePercent(tokens: number, quota: ColdResumeQuota): number | null {
	const percent = (tokens / 1e6) * quota.percentPerMillionTokens;
	return percent >= quota.minPercent ? Math.round(percent) : null;
}

/** Upstream's idle clock start: the later of the newest transcript record and the last activity. */
export function idleSince({
	lastRecordMs,
	lastActivityMs,
}: {
	lastRecordMs: number | null;
	lastActivityMs: number | null;
}): number | null {
	if (lastRecordMs === null) return lastActivityMs;
	if (lastActivityMs === null) return lastRecordMs;
	return Math.max(lastRecordMs, lastActivityMs);
}

/** Upstream `cj` with `unitDisplay: "long"`: whole hours, or whole days from 2880 minutes. */
export function formatIdleDuration(minutes: number): string {
	const days = minutes >= 2880;
	const value = days ? Math.floor(minutes / 1440) : Math.floor(minutes / 60);
	return new Intl.NumberFormat("en-US", {style: "unit", unit: days ? "day" : "hour", unitDisplay: "long"}).format(
		value,
	);
}

export interface ColdResumeDecision {
	readonly since: number;
	readonly idleMinutes: number;
	readonly percent: number;
	readonly usesRest: boolean;
}

/** Upstream `k6`'s detail line. */
export function coldResumeDetail({idleMinutes, percent, usesRest}: Omit<ColdResumeDecision, "since">): string {
	const idle = formatIdleDuration(idleMinutes);
	if (usesRest) return COLD_RESUME_COPY.detailUsesRest.replace("{idle}", idle);
	const percentText = new Intl.NumberFormat("en-US", {style: "percent"}).format(percent / 100);
	return COLD_RESUME_COPY.detail.replace("{idle}", idle).replace("{percent}", percentText);
}

export interface ColdResumeInput {
	readonly nowMs: number;
	readonly since: number | null;
	readonly contextTokens: number | null;
	/** The five-hour window's utilization; null while unknown. */
	readonly fiveHourPct: number | null;
	/** Some window is at its limit, so the usage-limit band shows instead. */
	readonly anyWindowSpent: boolean;
	readonly running: boolean;
	readonly heldInput: boolean;
	readonly focused: boolean;
	readonly visible: boolean;
	/** The idle start already answered (Resume / Dismiss / Compact / New session). */
	readonly answeredSince: number | null;
	/** The idle start the user already sent over. */
	readonly sentOverSince: number | null;
}

/** Upstream `Wge`'s show decision (`ce` / `le`), less the experiment, plan and ownership gates. */
export function decideColdResume(input: ColdResumeInput): ColdResumeDecision | null {
	const {since, contextTokens, fiveHourPct} = input;
	if (since === null || contextTokens === null || fiveHourPct === null) return null;
	if (input.running || input.heldInput || !input.focused || !input.visible || input.anyWindowSpent) return null;
	if (input.answeredSince === since || input.sentOverSince === since) return null;
	const idleMs = input.nowMs - since;
	if (idleMs < COLD_RESUME_IDLE_MS) return null;
	const percent = coldResumePercent(contextTokens, COLD_RESUME_QUOTA);
	if (percent === null) return null;
	return {since, idleMinutes: Math.round(idleMs / 60_000), percent, usesRest: percent >= 100 - fiveHourPct};
}

/** Upstream `D6`'s newest message time: the last transcript record carrying a string `timestamp`. */
export function newestRecordMs(records: readonly unknown[]): number | null {
	for (let i = records.length - 1; i >= 0; i--) {
		const record = records[i];
		if (typeof record !== "object" || record === null || !("timestamp" in record)) continue;
		const {timestamp} = record;
		if (typeof timestamp !== "string") continue;
		const ms = Date.parse(timestamp);
		if (Number.isFinite(ms)) return ms;
	}
	return null;
}

interface SpendableWindow {
	readonly usedPercentage: number;
	/** Epoch seconds. */
	readonly resetsAt: number;
}

/** Upstream `ae` inverted: some window sits at its limit before its reset, so the limit band shows instead. */
export function usageWindowSpent(
	usage: {readonly fiveHour: SpendableWindow | null; readonly weekly: SpendableWindow | null} | null,
	nowMs: number,
): boolean {
	if (usage === null) return false;
	return [usage.fiveHour, usage.weekly].some(
		(window) => window !== null && window.usedPercentage >= 100 && window.resetsAt * 1000 > nowMs,
	);
}

/** One session's retired idle stretches. */
export interface ColdResumeRecord {
	answeredSince: number | null;
	sentOverSince: number | null;
}

/** Upstream's module Map `x6`, in memory only: a reload starts fresh, so the notice shows once per opening. */
const coldResumeStore = new Map<string, ColdResumeRecord>();

/** The session's mutable record in the store, created on first use. */
export function coldResumeRecord(sessionId: string): ColdResumeRecord {
	let record = coldResumeStore.get(sessionId);
	if (record === undefined) {
		record = {answeredSince: null, sentOverSince: null};
		coldResumeStore.set(sessionId, record);
	}
	return record;
}

/** Forget every answered and sent-over stretch, as a page reload does. */
export function resetColdResumeStore(): void {
	coldResumeStore.clear();
}
