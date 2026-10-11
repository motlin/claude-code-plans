import {describe, expect, it} from "vite-plus/test";
import {formatNarrowRelativeTime} from "../src/lib/relative-time";

const NOW = Date.parse("2026-10-11T16:53:00.000Z");
const MINUTE = 60_000;

describe("formatNarrowRelativeTime", () => {
	it("rounds to the nearest unit like claude.ai/code", () => {
		const elapsed = {
			seconds: 40_000,
			minutes: 14 * MINUTE + 31_000,
			// Upstream showed "2h ago" at 16:53Z for a session waiting since 15:01:39Z.
			almostTwoHours: Date.parse("2026-10-11T16:53:00.000Z") - Date.parse("2026-10-11T15:01:39.000Z"),
			hourAndAQuarter: 75 * MINUTE,
			dayAndAHalfLess: 35 * 60 * MINUTE,
			days: (13 * 24 + 14) * 60 * MINUTE,
		};
		expect(
			Object.fromEntries(
				Object.entries(elapsed).map(([name, ms]) => [name, formatNarrowRelativeTime(NOW - ms, NOW)]),
			),
		).toStrictEqual({
			seconds: "now",
			minutes: "15m ago",
			almostTwoHours: "2h ago",
			hourAndAQuarter: "1h ago",
			dayAndAHalfLess: "1d ago",
			days: "14d ago",
		});
	});
});
