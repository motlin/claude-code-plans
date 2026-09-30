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

function formatParts(resetsAt: number, timeZone: string | undefined, weekday: boolean): string {
	return new Intl.DateTimeFormat("en-US", {
		...(weekday ? {weekday: "short" as const} : {}),
		hour: "numeric",
		minute: "2-digit",
		...(timeZone === undefined ? {} : {timeZone}),
	})
		.format(resetsAt * 1000)
		.replace(",", "");
}

/** "Resets at 5:40 PM". */
export function formatSessionReset(resetsAt: number, timeZone?: string): string {
	return `Resets at ${formatParts(resetsAt, timeZone, false)}`;
}

/** "Resets Fri 9:00 AM". */
export function formatWeeklyReset(resetsAt: number, timeZone?: string): string {
	return `Resets ${formatParts(resetsAt, timeZone, true)}`;
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
		const time = formatParts(resetsAt, timeZone, false);
		return `You’ve hit the limit. It resets ${resetDay(resetsAt, nowMs, timeZone)} at ${time}.`;
	}

	const ahead = windows.find((paced) => paced.window.usedPct / 100 > elapsedFraction(paced, nowMs));
	if (ahead) {
		return `You may hit the limit before ${resetDay(ahead.window.resetsAt, nowMs, timeZone)}’s reset.`;
	}
	return `On track. You should reach ${resetDay(primary.window.resetsAt, nowMs, timeZone)}’s reset with room to spare.`;
}
