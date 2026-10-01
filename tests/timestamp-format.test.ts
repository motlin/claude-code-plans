import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {formatRelativeTimestamp, formatTimestamp} from "../src/lib/timestamp-format";

const NOW_MS = Date.UTC(2026, 8, 30, 12, 0, 0);

function ago(ms: number): string {
	return new Date(NOW_MS - ms).toISOString();
}

describe("formatRelativeTimestamp", () => {
	it.each([
		{name: "same instant", timestamp: ago(0), expected: "now"},
		{name: "seconds", timestamp: ago(42_000), expected: "42 seconds ago"},
		{name: "one minute", timestamp: ago(60_000), expected: "1 minute ago"},
		{name: "minutes", timestamp: ago(47 * 60_000), expected: "47 minutes ago"},
		{name: "one hour", timestamp: ago(3_600_000), expected: "1 hour ago"},
		{name: "nine hours", timestamp: ago(9 * 3_600_000 + 20 * 60_000), expected: "9 hours ago"},
		{name: "ten hours", timestamp: ago(10 * 3_600_000), expected: "10 hours ago"},
		{name: "one day", timestamp: ago(30 * 3_600_000), expected: "yesterday"},
		{name: "days", timestamp: ago(3 * 86_400_000), expected: "3 days ago"},
		{name: "one week", timestamp: ago(8 * 86_400_000), expected: "last week"},
		{name: "weeks", timestamp: ago(15 * 86_400_000), expected: "2 weeks ago"},
		{name: "one month", timestamp: ago(40 * 86_400_000), expected: "last month"},
		{name: "months", timestamp: ago(100 * 86_400_000), expected: "3 months ago"},
		{name: "one year", timestamp: ago(400 * 86_400_000), expected: "last year"},
		{name: "future clock skew", timestamp: new Date(NOW_MS + 5_000).toISOString(), expected: "now"},
		{name: "missing", timestamp: undefined, expected: null},
		{name: "unparseable", timestamp: "not a date", expected: null},
	])("$name", ({timestamp, expected}) => {
		expect(formatRelativeTimestamp(timestamp, NOW_MS)).toBe(expected);
	});
});

describe("formatTimestamp", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it.each([
		{name: "today", timestamp: "2026-09-30T08:05:00.000Z", expected: "Sep 30, 2026, 8:05 AM"},
		{
			name: "today in New York",
			timestamp: "2026-09-30T08:05:00.000Z",
			timeZone: "America/New_York",
			expected: "Sep 30, 2026, 4:05 AM",
		},
		{name: "earlier this year", timestamp: "2026-09-20T13:26:00.000Z", expected: "Sep 20, 2026, 1:26 PM"},
		{name: "previous year", timestamp: "2025-12-31T23:59:00.000Z", expected: "Dec 31, 2025, 11:59 PM"},
		{name: "midnight", timestamp: "2026-01-02T00:00:00.000Z", expected: "Jan 2, 2026, 12:00 AM"},
		{name: "missing", timestamp: undefined, expected: null},
		{name: "unparseable", timestamp: "not a date", expected: null},
	])("$name", ({timestamp, timeZone = "UTC", expected}) => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW_MS);
		expect(formatTimestamp(timestamp, timeZone)).toBe(expected);
	});
});
