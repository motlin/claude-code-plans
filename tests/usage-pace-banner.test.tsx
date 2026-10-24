// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ResetCountdown} from "../src/components/reset-countdown";
import {UsageLimitBand, UsagePaceBand} from "../src/components/usage-pace-banner";
import {
	approachingLimit,
	formatPaceBannerReset,
	limitReached,
	paceState,
	usageBand,
	weeklyAheadOfPace,
	type UsageSummary,
} from "../src/lib/usage";
import {readUsageBandDismissals, writeUsageBandDismissal} from "../src/lib/usage-pace-dismissal";

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
		{name: "5% used 7.5h into the week (fresh)", usage: summary([5, 7 * DAY - 7.5 * HOUR]), expected: false},
		{
			name: "9% used 3 days in, running out before the reset (fresh)",
			usage: summary([9, 4 * DAY]),
			expected: false,
		},
		{name: "20% used 6h into the week (early)", usage: summary([20, 7 * DAY - 6 * HOUR]), expected: false},
		{name: "40% used 2 days into the week (heads up)", usage: summary([40, 5 * DAY]), expected: true},
		{name: "75% used 3 days in is past the 70% ceiling", usage: summary([75, 4 * DAY]), expected: false},
	])("$name", ({usage, expected}) => {
		expect(weeklyAheadOfPace(usage, NOW_MS)).toBe(expected);
	});
});

describe("paceState", () => {
	const window = (usedPct: number, resetsInSeconds: number) => ({usedPct, resetsAt: NOW_SECONDS + resetsInSeconds});
	const resetsAtMs = NOW_MS + 4 * DAY * 1000;

	it.each([
		{name: "limit_hit at 100%", usedPct: 100.4, expected: {state: "limit_hit", percent: 100, resetsAtMs}},
		{name: "zero at 0%", usedPct: 0.2, expected: {state: "zero", percent: 0, resetsAtMs}},
		{name: "zero when negative", usedPct: -3, expected: {state: "zero", percent: 0, resetsAtMs}},
		{name: "fresh below 10%", usedPct: 9.4, expected: {state: "fresh", percent: 9, resetsAtMs}},
		{
			name: "on_track when the run-out is after the reset",
			usedPct: 20,
			expected: {state: "on_track", percent: 20, resetsAtMs},
		},
		{
			name: "heads_up when the run-out lands before the reset",
			usedPct: 60,
			expected: {state: "heads_up", percent: 60, runsOutAtMs: NOW_MS + 2 * DAY * 1000, resetsAtMs},
		},
	])("$name", ({usedPct, expected}) => {
		expect(paceState(window(usedPct, 4 * DAY), NOW_MS)).toStrictEqual(expected);
	});

	it("is early before 12h into the window", () => {
		const resetsIn = 7 * DAY - 11 * HOUR;
		expect(paceState(window(50, resetsIn), NOW_MS)).toStrictEqual({
			state: "early",
			percent: 50,
			resetsAtMs: NOW_MS + resetsIn * 1000,
		});
	});

	it("is early when the reset has already passed", () => {
		expect(paceState(window(50, -HOUR), NOW_MS)).toStrictEqual({state: "early", percent: 50, resetsAtMs: null});
	});
});

describe("approachingLimit", () => {
	it.each([
		{name: "under 70% everywhere", usage: summary([69, 4 * DAY], [69, HOUR]), expected: null},
		{
			name: "weekly at 72%",
			usage: summary([72, 4 * DAY]),
			expected: {
				window: "7d",
				headline: "Approaching weekly usage limit",
				resetsAt: NOW_SECONDS + 4 * DAY,
				threshold: 70,
			},
		},
		{
			name: "weekly at 91% uses the 90 threshold",
			usage: summary([91, 4 * DAY]),
			expected: {
				window: "7d",
				headline: "Approaching weekly usage limit",
				resetsAt: NOW_SECONDS + 4 * DAY,
				threshold: 90,
			},
		},
		{
			name: "session at 80% while the weekly window is not approaching",
			usage: summary([40, 4 * DAY], [80, HOUR]),
			expected: {
				window: "5h",
				headline: "Approaching session usage limit",
				resetsAt: NOW_SECONDS + HOUR,
				threshold: 70,
			},
		},
		{
			name: "weekly wins over the session",
			usage: summary([75, 4 * DAY], [95, HOUR]),
			expected: {
				window: "7d",
				headline: "Approaching weekly usage limit",
				resetsAt: NOW_SECONDS + 4 * DAY,
				threshold: 70,
			},
		},
		{name: "a spent window is the reached band's, not this one", usage: summary([100, 4 * DAY]), expected: null},
		{name: "a window whose reset has passed", usage: summary([80, -HOUR]), expected: null},
	])("$name", ({usage, expected}) => {
		expect(approachingLimit(usage, NOW_MS)).toStrictEqual(expected);
	});
});

describe("usageBand", () => {
	const weeklyReset = NOW_SECONDS + 4 * DAY;

	it("shows the on-pace band when ahead of pace and never dismissed", () => {
		expect(usageBand(summary([29, 6 * DAY]), NOW_MS, {})).toStrictEqual({
			kind: "pace",
			window: "7d",
			headline: "On pace to hit your weekly limit early",
			usedPct: 29,
			resetsAt: NOW_SECONDS + 6 * DAY,
			threshold: -1,
		});
	});

	it("shows nothing when behind pace", () => {
		expect(usageBand(summary([10, 3.5 * DAY]), NOW_MS, {})).toBeNull();
	});

	it("shows the approaching band at 72% weekly", () => {
		expect(usageBand(summary([72, 4 * DAY]), NOW_MS, {})).toStrictEqual({
			kind: "approaching",
			window: "7d",
			headline: "Approaching weekly usage limit",
			resetsAt: weeklyReset,
			threshold: 70,
		});
	});

	it("hides a dismissed band until a higher threshold is crossed", () => {
		const dismissed = {"7d": {validUntil: weeklyReset, threshold: 70}};
		expect({
			at72: usageBand(summary([72, 4 * DAY]), NOW_MS, dismissed),
			at91: usageBand(summary([91, 4 * DAY]), NOW_MS, dismissed)?.threshold,
		}).toStrictEqual({at72: null, at91: 90});
	});

	it("shows a dismissed band again once the window resets", () => {
		const dismissed = {"7d": {validUntil: weeklyReset, threshold: 70}};
		expect(usageBand(summary([72, 11 * DAY]), NOW_MS, dismissed)?.kind).toBe("approaching");
	});

	it("shows the approaching band after the on-pace band was dismissed", () => {
		const dismissed = {"7d": {validUntil: weeklyReset, threshold: -1}};
		expect({
			pace: usageBand(summary([40, 4 * DAY]), NOW_MS, dismissed),
			approaching: usageBand(summary([72, 4 * DAY]), NOW_MS, dismissed)?.kind,
		}).toStrictEqual({pace: null, approaching: "approaching"});
	});

	it("keeps a session dismissal from hiding the weekly band", () => {
		const dismissed = {"5h": {validUntil: weeklyReset, threshold: 90}};
		expect(usageBand(summary([72, 4 * DAY]), NOW_MS, dismissed)?.kind).toBe("approaching");
	});
});

describe("formatPaceBannerReset", () => {
	it("formats the weekly reset with weekday, month, day and time", () => {
		const otherDay = Date.UTC(2026, 9, 1, 12, 0);
		expect(formatPaceBannerReset(Date.UTC(2026, 9, 6, 4, 0) / 1000, otherDay, "UTC")).toBe(
			"Resets Tue, Oct 6, 4:00 AM",
		);
	});

	it("reads 'Resets at 5:40 PM' on the reset's own day, as upstream does", () => {
		const morning = Date.UTC(2026, 9, 14, 9, 0);
		expect(formatPaceBannerReset(Date.UTC(2026, 9, 14, 17, 40) / 1000, morning, "UTC")).toBe("Resets at 5:40 PM");
	});
});

describe("usage band dismissal storage", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("round-trips a per-window dismissal", () => {
		expect(readUsageBandDismissals()).toStrictEqual({});
		writeUsageBandDismissal("7d", {validUntil: NOW_SECONDS + DAY, threshold: 70});
		writeUsageBandDismissal("5h", {validUntil: NOW_SECONDS + HOUR, threshold: 90});
		expect(readUsageBandDismissals()).toStrictEqual({
			"7d": {validUntil: NOW_SECONDS + DAY, threshold: 70},
			"5h": {validUntil: NOW_SECONDS + HOUR, threshold: 90},
		});
	});

	it("treats corrupt storage as never dismissed", () => {
		localStorage.setItem("ccp-usage-band-dismissed", "not json");
		expect(readUsageBandDismissals()).toStrictEqual({});
	});
});

describe("UsagePaceBand", () => {
	it("renders the upstream band text and dismisses", () => {
		const onDismiss = vi.fn<() => void>();
		render(<UsagePaceBand usedPct={29} resetText="Resets Tue, Oct 6, 4:00 AM" onDismiss={onDismiss} />);

		const band = screen.getByRole("status");
		expect(band.textContent).toBe("On pace to hit your weekly limit early29% used · Resets Tue, Oct 6, 4:00 AM");
		const headline = screen.getByText("On pace to hit your weekly limit early");
		const detail = screen.getByText("29% used · Resets Tue, Oct 6, 4:00 AM");
		const words = detail.parentElement;
		const dismiss = screen.getByRole("button", {name: "Dismiss"});
		// Upstream's band shell `uc`: icon slot, wrapping body > words (10px gap), Dismiss slot.
		expect({
			ariaLive: band.getAttribute("aria-live"),
			band: band.className,
			icon: band.firstElementChild?.className,
			body: words?.parentElement?.parentElement?.className,
			wordsWrapper: words?.parentElement?.className,
			words: words?.className,
			headline: headline.className,
			detail: detail.className,
			dismissWrapper: dismiss.parentElement?.className,
			dismiss: dismiss.className,
		}).toStrictEqual({
			ariaLive: "polite",
			band: "flex gap-[5px] w-full min-h-[40px] p-[8px] rounded-r7 bg-alpha-1 items-start py-[calc((40px-1lh)/2)] text-body usage-band-enter",
			icon: "flex h-[1lh] shrink-0 items-center",
			body: "flex min-w-0 flex-1 flex-wrap gap-x-[8px] gap-y-[8px] items-start",
			wordsWrapper: "min-w-0 max-w-full flex-auto",
			words: "flex flex-wrap items-baseline gap-x-2.5 gap-y-0.75",
			headline: "min-w-0 text-primary",
			detail: "min-w-0 text-ink-muted",
			dismissWrapper: "ms-1.25 flex h-[1lh] shrink-0 items-center",
			dismiss:
				"inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-alpha-1 hover:text-primary cursor-pointer",
		});

		fireEvent.click(screen.getByRole("button", {name: "Dismiss"}));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});

describe("UsagePaceBand approaching", () => {
	it("renders the approaching headline and reset with no percent", () => {
		render(
			<UsagePaceBand
				headline="Approaching weekly usage limit"
				resetText="Resets Tue, Oct 27, 4:00 AM"
				onDismiss={() => {}}
			/>,
		);
		expect(screen.getByRole("status").textContent).toBe(
			"Approaching weekly usage limitResets Tue, Oct 27, 4:00 AM",
		);
	});
});

describe("usage limit reached", () => {
	it("names the exhausted window still before its reset, weekly first, as upstream's composer banner", () => {
		expect([
			limitReached(summary([100, 6 * DAY]), NOW_MS),
			limitReached(summary([40, 6 * DAY], [100, HOUR]), NOW_MS),
			limitReached(summary([100, -HOUR]), NOW_MS),
			limitReached(summary([99, 6 * DAY]), NOW_MS),
		]).toStrictEqual([
			{headline: "Weekly limit reached", resetsAt: NOW_SECONDS + 6 * DAY},
			{headline: "Session limit reached", resetsAt: NOW_SECONDS + HOUR},
			null,
			null,
		]);
	});

	it("draws the exceeded band in danger ink with the reset countdown and no dismiss", () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.UTC(2026, 9, 20, 16, 0));
		try {
			render(<UsageLimitBand headline="Weekly limit reached" resetsAt={Date.UTC(2026, 9, 20, 18, 0) / 1000} />);
			const band = screen.getByRole("status");
			const headline = screen.getByText("Weekly limit reached");
			const detail = screen.getByText("Resets at 6:00 PM");
			expect({
				text: band.textContent,
				icon: band.firstElementChild?.firstElementChild?.getAttribute("class"),
				headline: headline.className,
				detail: detail.parentElement?.className,
				dismiss: screen.queryByRole("button", {name: "Dismiss"}),
			}).toStrictEqual({
				text: "Weekly limit reachedResets at 6:00 PM",
				icon: "lucide lucide-gauge size-4 text-danger-000",
				headline: "min-w-0 text-danger-000",
				detail: "min-w-0 text-ink-muted",
				dismiss: null,
			});
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("ResetCountdown", () => {
	const NOW = Date.UTC(2026, 9, 20, 16, 0);

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function countdown(secondsAhead: number) {
		render(<ResetCountdown resetsAt={NOW / 1000 + secondsAhead} />);
		return screen.getByTestId("reset-countdown");
	}

	it("shows the absolute reset an hour or more ahead", () => {
		const node = countdown(2 * HOUR);
		expect({text: node.textContent, live: node.getAttribute("aria-live"), className: node.className}).toStrictEqual(
			{
				text: "Resets at 6:00 PM",
				live: "off",
				className: "tabular-nums",
			},
		);
	});

	it("counts minutes under an hour", () => {
		expect(countdown(37 * 60).textContent).toBe("Resets in 37 min");
	});

	it("counts minutes and two-digit seconds under ten minutes, ticking every second", () => {
		const node = countdown(9 * 60 + 5);
		expect(node.textContent).toBe("Resets in 9:05");
		act(() => {
			vi.advanceTimersByTime(5000);
		});
		expect(node.textContent).toBe("Resets in 9:00");
	});

	it("reads 'Resetting…' once the reset arrives", () => {
		expect(countdown(0).textContent).toBe("Resetting\u2026");
	});
});
