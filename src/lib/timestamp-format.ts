const ABSOLUTE_FORMAT: Intl.DateTimeFormatOptions = {
	month: "short",
	day: "numeric",
	year: "numeric",
	hour: "numeric",
	minute: "2-digit",
	hour12: true,
};

function parseTimestamp(timestamp?: string): Date | null {
	if (!timestamp) return null;
	const date = new Date(timestamp);
	return isNaN(date.getTime()) ? null : date;
}

/**
 * Formats an ISO timestamp the way claude.ai/code's toolbar time tooltip does: "Sep 20, 2026, 1:26 PM",
 * always with the date, in the viewer's time zone unless one is given. Returns null for missing or
 * unparseable input.
 */
export function formatTimestamp(timestamp?: string, timeZone?: string): string | null {
	const date = parseTimestamp(timestamp);
	if (!date) return null;
	return date.toLocaleString("en-US", timeZone === undefined ? ABSOLUTE_FORMAT : {...ABSOLUTE_FORMAT, timeZone});
}

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
	["year", 365 * 86_400],
	["month", 30 * 86_400],
	["week", 7 * 86_400],
	["day", 86_400],
	["hour", 3_600],
	["minute", 60],
];

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat("en-US", {numeric: "auto"});

/**
 * Formats an ISO timestamp the way claude.ai/code's relative times do: the largest unit it has
 * reached, rounded ("18 days" reads "3 weeks ago"), and "just now" under a minute. Returns null for
 * missing or unparseable input.
 */
export function formatRelativeTimestamp(timestamp?: string, nowMs: number = Date.now()): string | null {
	const date = parseTimestamp(timestamp);
	if (!date) return null;
	const seconds = Math.max(0, (nowMs - date.getTime()) / 1000);
	for (const [unit, size] of RELATIVE_UNITS) {
		if (seconds >= size) return RELATIVE_FORMAT.format(-Math.round(seconds / size), unit);
	}
	return "just now";
}

/** Upstream's message `<time>` turns absolute once a message is a week old. */
const ABSOLUTE_AFTER_MS = 168 * 3_600_000;

/**
 * Formats a message's hover time as claude.ai/code does: relative for a week, then the date
 * ("Sep 26", with the year when it is not the current one).
 */
export function formatMessageTime(timestamp?: string, nowMs: number = Date.now(), timeZone?: string): string | null {
	const date = parseTimestamp(timestamp);
	if (!date) return null;
	if (nowMs - date.getTime() < ABSOLUTE_AFTER_MS) return formatRelativeTimestamp(timestamp, nowMs);
	const zone = timeZone === undefined ? {} : {timeZone};
	const year = (at: Date) => at.toLocaleString("en-US", {year: "numeric", ...zone});
	const sameYear = year(date) === year(new Date(nowMs));
	return date.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		...(sameYear ? {} : {year: "numeric"}),
		...zone,
	});
}
