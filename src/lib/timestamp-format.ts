const TIME_FORMAT: Intl.DateTimeFormatOptions = {
	hour: "numeric",
	minute: "2-digit",
	hour12: true,
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
	month: "short",
	day: "numeric",
	year: "numeric",
};

function parseTimestamp(timestamp?: string): Date | null {
	if (!timestamp) return null;
	const date = new Date(timestamp);
	return isNaN(date.getTime()) ? null : date;
}

/**
 * Formats an ISO timestamp as an absolute, human-readable time. Returns just the
 * time of day for timestamps that fall on the current day, otherwise prefixes the
 * date. Returns null for missing or unparseable input.
 */
export function formatTimestamp(timestamp?: string): string | null {
	const date = parseTimestamp(timestamp);
	if (!date) return null;

	const time = date.toLocaleTimeString("en-US", TIME_FORMAT);
	const isToday = date.toDateString() === new Date().toDateString();
	if (isToday) return time;

	return `${date.toLocaleDateString("en-US", DATE_FORMAT)} ${time}`;
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
 * Formats an ISO timestamp the way claude.ai/code's hover `<time>` does: "10 hours ago",
 * "yesterday", "now". Returns null for missing or unparseable input.
 */
export function formatRelativeTimestamp(timestamp?: string, nowMs: number = Date.now()): string | null {
	const date = parseTimestamp(timestamp);
	if (!date) return null;
	const seconds = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
	for (const [unit, size] of RELATIVE_UNITS) {
		if (seconds >= size) return RELATIVE_FORMAT.format(-Math.floor(seconds / size), unit);
	}
	return RELATIVE_FORMAT.format(-seconds, "second");
}
