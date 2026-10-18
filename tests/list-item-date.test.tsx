import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vite-plus/test";
import {ListItemDate} from "../src/components/list-item-date";
import {formatListDate, formatShortDate} from "../src/lib/timestamp-format";

const NOW_MS = Date.UTC(2026, 9, 18, 12, 0, 0);

describe("formatShortDate", () => {
	it.each([
		{name: "same year drops the year", iso: "2026-10-17T21:34:00.000Z", expected: "Oct 17"},
		{name: "start of the current year", iso: "2026-01-01T00:00:00.000Z", expected: "Jan 1"},
		{name: "another year keeps it", iso: "2025-10-17T21:34:00.000Z", expected: "Oct 17, 2025"},
		{name: "late UTC evening stays on its UTC day", iso: "2025-12-31T23:59:00.000Z", expected: "Dec 31, 2025"},
		{name: "unparseable", iso: "not a date", expected: null},
	])("$name", ({iso, expected}) => {
		expect(formatShortDate(iso, NOW_MS)).toBe(expected);
	});
});

describe("formatListDate", () => {
	it("formats the full UTC date and time", () => {
		expect(formatListDate("2026-10-17T21:34:00.000Z")).toBe("Oct 17, 2026, 09:34 PM");
	});
});

describe("ListItemDate", () => {
	it("renders the short date under 640px and the full date from sm up", () => {
		expect(renderToStaticMarkup(<ListItemDate iso="2026-10-17T21:34:00.000Z" nowMs={NOW_MS} />)).toBe(
			'<span class="ml-4 shrink-0 text-xs text-t6"><span class="sm:hidden">Oct 17</span><span class="max-sm:hidden">Oct 17, 2026, 09:34 PM</span></span>',
		);
	});
});
