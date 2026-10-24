import {z} from "zod";

/**
 * Settings ▸ Usage: the plan's rate-limit windows as the newest Claude Code
 * statusline reported them, plus the copy upstream derives from them.
 */

export interface UsageWindow {
	usedPct: number;
	/** Epoch seconds. */
	resetsAt: number;
}

export interface UsageSummary {
	fiveHour: UsageWindow | null;
	sevenDay: UsageWindow | null;
	/** ISO mtime of the statusline the windows came from. */
	updatedAt: string | null;
}

const UsageWindowSchema = z.strictObject({usedPct: z.number(), resetsAt: z.number()});

export const UsageSummaryResponse: z.ZodType<UsageSummary> = z.strictObject({
	fiveHour: UsageWindowSchema.nullable(),
	sevenDay: UsageWindowSchema.nullable(),
	updatedAt: z.string().nullable(),
});

export const EMPTY_USAGE: UsageSummary = {fiveHour: null, sevenDay: null, updatedAt: null};

const FIVE_HOUR_MS = 5 * 3_600_000;
const SEVEN_DAY_MS = 7 * 86_400_000;

/** Whole-number percent clamped to the meter's 0–100 range. */
export function meterPercent(usedPct: number): number {
	return Math.min(100, Math.max(0, Math.round(usedPct)));
}

function formatParts(resetsAt: number, timeZone: string | undefined, weekday?: "short" | "long"): string {
	return new Intl.DateTimeFormat("en-US", {
		...(weekday === undefined ? {} : {weekday}),
		hour: "numeric",
		minute: "2-digit",
		...(timeZone === undefined ? {} : {timeZone}),
	})
		.format(resetsAt * 1000)
		.replace(",", "");
}

/** "Resets at 5:40 PM". */
export function formatSessionReset(resetsAt: number, timeZone?: string): string {
	return `Resets at ${formatParts(resetsAt, timeZone)}`;
}

/** "Resets Fri 9:00 AM". */
export function formatWeeklyReset(resetsAt: number, timeZone?: string): string {
	return `Resets ${formatParts(resetsAt, timeZone, "short")}`;
}

/** Settings ▸ Usage's "Resets Tuesday 4:00 AM", with upstream's full weekday. */
export function formatWeeklyResetLong(resetsAt: number, timeZone?: string): string {
	return `Resets ${formatParts(resetsAt, timeZone, "long")}`;
}

function calendarDay(ms: number, timeZone: string | undefined): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		...(timeZone === undefined ? {} : {timeZone}),
	}).formatToParts(ms);
	const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	return Date.UTC(part("year"), part("month") - 1, part("day")) / 86_400_000;
}

/** "today", "tomorrow" or the weekday name of the reset. */
function resetDay(resetsAt: number, nowMs: number, timeZone: string | undefined): string {
	const days = calendarDay(resetsAt * 1000, timeZone) - calendarDay(nowMs, timeZone);
	if (days <= 0) return "today";
	if (days === 1) return "tomorrow";
	return new Intl.DateTimeFormat("en-US", {
		weekday: "long",
		...(timeZone === undefined ? {} : {timeZone}),
	}).format(resetsAt * 1000);
}

interface PacedWindow {
	window: UsageWindow;
	lengthMs: number;
}

function elapsedFraction({window, lengthMs}: PacedWindow, nowMs: number): number {
	const remaining = window.resetsAt * 1000 - nowMs;
	return Math.min(1, Math.max(0, 1 - remaining / lengthMs));
}

function isAheadOfPace(paced: PacedWindow, nowMs: number): boolean {
	return paced.window.usedPct / 100 > elapsedFraction(paced, nowMs);
}

export type PaceState = "zero" | "fresh" | "early" | "on_track" | "heads_up" | "limit_hit";

export interface Pace {
	state: PaceState;
	/** Whole-number percent used, floored at 0. */
	percent: number;
	/** The reset rounded to the minute, or null when it is unknown or already past. */
	resetsAtMs: number | null;
	/** The straight-line run-out time, only for `heads_up`. */
	runsOutAtMs?: number;
}

/** Upstream's `FR`: below this percent the week reads as fresh. */
const FRESH_PERCENT = 10;
/** Upstream's `432e5`: the projection waits until 12h into the window. */
const EARLY_MS = 12 * 3_600_000;
/** Upstream's `re`: above this utilization the server's threshold band replaces the on-pace one. */
const ON_PACE_CEILING_PCT = 70;

/** Upstream's weekly pace projection (shared-3 `Xi`). */
export function paceState(sevenDay: UsageWindow, nowMs: number): Pace {
	const resetMs = sevenDay.resetsAt * 1000;
	const resetsAtMs = Number.isFinite(resetMs) && resetMs > nowMs ? Math.round(resetMs / 60_000) * 60_000 : null;
	const percent = Number.isFinite(sevenDay.usedPct) ? Math.round(Math.max(0, sevenDay.usedPct)) : 0;
	if (percent >= 100) return {state: "limit_hit", percent, resetsAtMs};
	if (percent === 0) return {state: "zero", percent, resetsAtMs};
	if (percent < FRESH_PERCENT) return {state: "fresh", percent, resetsAtMs};
	const elapsed = resetsAtMs === null ? null : nowMs - (resetsAtMs - SEVEN_DAY_MS);
	if (resetsAtMs === null || elapsed === null || elapsed < EARLY_MS) return {state: "early", percent, resetsAtMs};
	const runsOutAtMs = nowMs + ((100 - percent) * elapsed) / percent;
	return runsOutAtMs < resetsAtMs
		? {state: "heads_up", percent, runsOutAtMs, resetsAtMs}
		: {state: "on_track", percent, resetsAtMs};
}

/** Upstream's on-pace gate: the weekly projection runs out before the reset while still under 70%. */
export function weeklyAheadOfPace(usage: UsageSummary, nowMs: number): boolean {
	const {sevenDay} = usage;
	if (sevenDay === null || sevenDay.usedPct >= ON_PACE_CEILING_PCT) return false;
	return paceState(sevenDay, nowMs).state === "heads_up";
}

/**
 * The window the statusline reports exhausted before its reset, as upstream's composer names a
 * reached limit: the weekly window first, then the session's. Null while neither is spent.
 */
export function limitReached(usage: UsageSummary, nowMs: number): {headline: string; resetsAt: number} | null {
	const spent = (window: UsageWindow | null) =>
		window !== null && window.usedPct >= 100 && window.resetsAt * 1000 > nowMs;
	if (usage.sevenDay !== null && spent(usage.sevenDay)) {
		return {headline: "Weekly limit reached", resetsAt: usage.sevenDay.resetsAt};
	}
	if (usage.fiveHour !== null && spent(usage.fiveHour)) {
		return {headline: "Session limit reached", resetsAt: usage.fiveHour.resetsAt};
	}
	return null;
}

/** The rate-limit window a composer usage band speaks for, in upstream's window names. */
export type UsageBandWindow = "5h" | "7d";

/** Upstream's `Kt` dismissal record: hidden until a higher threshold or a later reset. */
export interface UsageBandDismissal {
	/** The dismissed band's reset, epoch seconds. */
	validUntil: number;
	threshold: number;
}

export type UsageBandDismissals = Partial<Record<UsageBandWindow, UsageBandDismissal>>;

/** Upstream's `V9`: the on-pace band dismisses below every real threshold, so a crossed one re-shows. */
const PACE_THRESHOLD = -1;

/**
 * The server's `approaching_limit` thresholds. The statusline only carries the used percent, so
 * these are assumed: 70% matches upstream's on-pace ceiling (`re`), 90% is the next step.
 */
function approachingThreshold(usedPct: number): number {
	return usedPct >= 90 ? 90 : ON_PACE_CEILING_PCT;
}

export interface ApproachingLimit {
	window: UsageBandWindow;
	headline: string;
	resetsAt: number;
	threshold: number;
}

/**
 * Upstream's "approaching" band: a window at 70% or more but not yet spent, before its reset. The
 * weekly window binds first; the session window speaks only when the weekly one is not approaching.
 */
export function approachingLimit(usage: UsageSummary, nowMs: number): ApproachingLimit | null {
	const approaching = (window: UsageWindow | null): window is UsageWindow =>
		window !== null &&
		window.usedPct >= ON_PACE_CEILING_PCT &&
		window.usedPct < 100 &&
		window.resetsAt * 1000 > nowMs;
	if (approaching(usage.sevenDay)) {
		return {
			window: "7d",
			headline: "Approaching weekly usage limit",
			resetsAt: usage.sevenDay.resetsAt,
			threshold: approachingThreshold(usage.sevenDay.usedPct),
		};
	}
	if (approaching(usage.fiveHour)) {
		return {
			window: "5h",
			headline: "Approaching session usage limit",
			resetsAt: usage.fiveHour.resetsAt,
			threshold: approachingThreshold(usage.fiveHour.usedPct),
		};
	}
	return null;
}

export type UsageBand =
	| ({kind: "approaching"} & ApproachingLimit)
	| ({kind: "pace"; usedPct: number} & ApproachingLimit);

/** Upstream's `uU`: a dismissal holds while the threshold has not risen and the window has not reset. */
function isDismissed(dismissals: UsageBandDismissals, band: ApproachingLimit): boolean {
	const stored = dismissals[band.window];
	return stored !== undefined && band.threshold <= stored.threshold && band.resetsAt <= stored.validUntil;
}

/**
 * The composer's dismissible usage band: approaching a window's limit, else on pace to hit the
 * weekly limit early, unless the user dismissed it for this threshold and reset.
 */
export function usageBand(usage: UsageSummary, nowMs: number, dismissals: UsageBandDismissals): UsageBand | null {
	const approaching = approachingLimit(usage, nowMs);
	let band: UsageBand | null = null;
	if (approaching !== null) {
		band = {kind: "approaching", ...approaching};
	} else if (usage.sevenDay !== null && weeklyAheadOfPace(usage, nowMs)) {
		band = {
			kind: "pace",
			window: "7d",
			headline: "On pace to hit your weekly limit early",
			usedPct: usage.sevenDay.usedPct,
			resetsAt: usage.sevenDay.resetsAt,
			threshold: PACE_THRESHOLD,
		};
	}
	return band === null || isDismissed(dismissals, band) ? null : band;
}

/** Upstream's pace band reset: "Resets at 5:40 PM" on the reset's own day, else "Resets Tue, Oct 6, 4:00 AM". */
export function formatPaceBannerReset(resetsAt: number, nowMs: number, timeZone?: string): string {
	if (calendarDay(resetsAt * 1000, timeZone) === calendarDay(nowMs, timeZone)) {
		return `Resets at ${formatParts(resetsAt, timeZone)}`;
	}
	const when = new Intl.DateTimeFormat("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		...(timeZone === undefined ? {} : {timeZone}),
	}).format(resetsAt * 1000);
	return `Resets ${when}`;
}

/**
 * The pace line above the meters: used% against the elapsed fraction of each
 * window. The weekly window leads, since it is the one that outlasts a session.
 */
export function paceHeadline(usage: UsageSummary, nowMs: number, timeZone?: string): string | null {
	const windows: PacedWindow[] = [];
	if (usage.sevenDay) windows.push({window: usage.sevenDay, lengthMs: SEVEN_DAY_MS});
	if (usage.fiveHour) windows.push({window: usage.fiveHour, lengthMs: FIVE_HOUR_MS});
	const [primary] = windows;
	if (primary === undefined) return null;

	const exhausted = windows.find(({window}) => window.usedPct >= 100);
	if (exhausted) {
		const {resetsAt} = exhausted.window;
		const time = formatParts(resetsAt, timeZone);
		return `You’ve hit the limit. It resets ${resetDay(resetsAt, nowMs, timeZone)} at ${time}.`;
	}

	const ahead = windows.find((paced) => isAheadOfPace(paced, nowMs));
	if (ahead) {
		return `You may hit the limit before ${resetDay(ahead.window.resetsAt, nowMs, timeZone)}’s reset.`;
	}
	return `On track. You should reach ${resetDay(primary.window.resetsAt, nowMs, timeZone)}’s reset with room to spare.`;
}
