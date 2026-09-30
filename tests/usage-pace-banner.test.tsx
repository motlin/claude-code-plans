// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {UsagePaceBand} from "../src/components/usage-pace-banner";
import {formatPaceBannerReset, shouldShowPaceBanner, weeklyAheadOfPace, type UsageSummary} from "../src/lib/usage";
import {readPaceBannerDismissedUntil, writePaceBannerDismissedUntil} from "../src/lib/usage-pace-dismissal";

afterEach(cleanup);

const HOUR = 3600;
const DAY = 24 * HOUR;
const NOW_MS = Date.UTC(2026, 8, 30, 12, 0);
const NOW_SECONDS = NOW_MS / 1000;

function summary(weekly: [number, number] | null, session: [number, number] | null = null): UsageSummary {
	const toWindow = (window: [number, number] | null) =>
		window === null ? null : {usedPct: window[0], resetsAt: NOW_SECONDS + window[1]};
	return {fiveHour: toWindow(session), sevenDay: toWindow(weekly), updatedAt: new Date(NOW_MS).toISOString()};
}

describe("weeklyAheadOfPace", () => {
	it.each([
		{name: "29% used a day into the week", usage: summary([29, 6 * DAY]), expected: true},
		{name: "10% used halfway through the week", usage: summary([10, 3.5 * DAY]), expected: false},
		{name: "only the session window is ahead", usage: summary([10, 3.5 * DAY], [90, HOUR]), expected: false},
		{name: "the weekly limit is already hit", usage: summary([100, 6 * DAY]), expected: false},
		{name: "no weekly window", usage: summary(null, [90, HOUR]), expected: false},
	])("$name", ({usage, expected}) => {
		expect(weeklyAheadOfPace(usage, NOW_MS)).toBe(expected);
	});
});

describe("shouldShowPaceBanner", () => {
	const ahead = summary([29, 6 * DAY]);

	it("shows when ahead of pace and never dismissed", () => {
		expect(shouldShowPaceBanner(ahead, NOW_MS, null)).toBe(true);
	});

	it("hides when behind pace", () => {
		expect(shouldShowPaceBanner(summary([10, 3.5 * DAY]), NOW_MS, null)).toBe(false);
	});

	it("hides until the dismissed reset passes", () => {
		expect(shouldShowPaceBanner(ahead, NOW_MS, NOW_SECONDS + 6 * DAY)).toBe(false);
	});

	it("shows again once the dismissed reset is in the past", () => {
		expect(shouldShowPaceBanner(ahead, NOW_MS, NOW_SECONDS - HOUR)).toBe(true);
	});
});

describe("formatPaceBannerReset", () => {
	it("formats the weekly reset with weekday, month, day and time", () => {
		expect(formatPaceBannerReset(Date.UTC(2026, 9, 6, 4, 0) / 1000, "UTC")).toBe("Resets Tue, Oct 6, 4:00 AM");
	});
});

describe("pace banner dismissal storage", () => {
	beforeEach(() => localStorage.clear());

	it("round-trips the dismissed-until reset time", () => {
		expect(readPaceBannerDismissedUntil()).toBeNull();
		writePaceBannerDismissedUntil(NOW_SECONDS + DAY);
		expect(readPaceBannerDismissedUntil()).toBe(NOW_SECONDS + DAY);
	});

	it("treats corrupt storage as never dismissed", () => {
		localStorage.setItem("ccp-usage-pace-dismissed-until", "not a number");
		expect(readPaceBannerDismissedUntil()).toBeNull();
	});
});

describe("UsagePaceBand", () => {
	it("renders the upstream band text and dismisses", () => {
		const onDismiss = vi.fn();
		render(<UsagePaceBand usedPct={29} resetText="Resets Tue, Oct 6, 4:00 AM" onDismiss={onDismiss} />);

		const band = screen.getByRole("status");
		expect(band.textContent).toBe("On pace to hit your weekly limit early29% used · Resets Tue, Oct 6, 4:00 AM");
		expect(band.className).toBe(
			"flex min-h-[40px] items-center gap-[5px] rounded-r7 bg-alpha-1 p-[8px] text-[13px] leading-[19px]",
		);

		fireEvent.click(screen.getByRole("button", {name: "Dismiss"}));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});
