// @vitest-environment jsdom

import {QueryClient} from "@tanstack/react-query";
import {describe, expect, it} from "vite-plus/test";
import {sessionQueryKeys} from "../../src/lib/api/sessions";
import {startLaunchJourneys, startSessionSwitchJourney} from "../../src/lib/perf/field-journeys";
import type {JourneySample} from "../../src/lib/perf/journey";
import {
	flushMicrotasks,
	makeJourneyHarness,
	pointerDownAt,
	useJourneyHarnessLifecycle,
	type JourneyHarness,
} from "./harness/journey-harness";

useJourneyHarnessLifecycle();

function element(html: string): HTMLElement {
	const template = document.createElement("template");
	template.innerHTML = html.trim();
	return template.content.firstElementChild as HTMLElement;
}

/** The session view of `sessionId`: its titlebar plus `rows` transcript rows, the last one marked last. */
function sessionView(sessionId: string, rows: number): HTMLElement {
	const turns = Array.from(
		{length: rows},
		(_, index) =>
			`<div data-testid="transcript-row" data-perf-row="assistant_text"${index === rows - 1 ? " data-perf-last" : ""}>turn ${index}</div>`,
	).join("");
	return element(
		`<div data-perf-session="${sessionId}"><div data-perf-region="header">Real title</div><div>${turns}</div></div>`,
	);
}

function summarize(sample: JourneySample) {
	return {
		journey: sample.journey,
		trigger: sample.trigger,
		start: sample.start,
		end: sample.end,
		...("prefetchHit" in sample ? {prefetchHit: sample.prefetchHit} : {}),
	};
}

async function paintAt(harness: JourneyHarness, clock: number): Promise<void> {
	await flushMicrotasks();
	harness.performance.clock = clock;
	harness.runFrame();
	await flushMicrotasks();
}

function queued(harness: JourneyHarness): ReturnType<typeof summarize>[] {
	harness.tracker.flush();
	return harness.sent.flat().map(summarize);
}

describe("J1 launch journeys", () => {
	it("ends F2 when the app frame paints and F1 only once sidebar recents and the home sections have rows", async () => {
		const harness = makeJourneyHarness({pathname: "/"});
		startLaunchJourneys("/", harness.tracker);

		const main = element('<div data-perf-region="main"><div data-home-action-center></div></div>');
		document.body.append(main);
		await paintAt(harness, 40);
		expect(queued(harness)).toStrictEqual([{journey: "F2", trigger: "navigation", start: 0, end: 40}]);

		document.body.append(
			element('<div data-perf-region="sidebar_recents"><a data-row-main-button>Session one</a></div>'),
		);
		await paintAt(harness, 90);
		expect(queued(harness)).toStrictEqual([{journey: "F2", trigger: "navigation", start: 0, end: 40}]);

		const sections = main.querySelector("[data-home-action-center]")!;
		sections.setAttribute("data-perf-ready", "");
		sections.append(element("<ul><li>Needs input</li></ul>"));
		await paintAt(harness, 150);

		expect(queued(harness)).toStrictEqual([
			{journey: "F2", trigger: "navigation", start: 0, end: 40},
			{journey: "F1", trigger: "navigation", start: 0, end: 150},
		]);
	});

	it("starts no launch journey on other routes", async () => {
		const harness = makeJourneyHarness({pathname: "/plans"});
		startLaunchJourneys("/plans", harness.tracker);
		document.body.append(element('<div data-perf-region="main">Plans</div>'));
		await paintAt(harness, 40);

		expect(queued(harness)).toStrictEqual([]);
	});
});

describe("J2 deep-link session open", () => {
	it("ends F4 when the session's header renders and F3 when its last transcript row is painted", async () => {
		const harness = makeJourneyHarness({pathname: "/session/abc-123"});
		startLaunchJourneys("/session/abc-123", harness.tracker);

		const view = element(
			'<div data-perf-session="abc-123"><div data-perf-region="header">Real title</div><div data-transcript></div></div>',
		);
		document.body.append(view);
		await paintAt(harness, 70);
		expect(queued(harness)).toStrictEqual([{journey: "F4", trigger: "navigation", start: 0, end: 70}]);

		view.querySelector("[data-transcript]")!.append(
			element('<div data-testid="transcript-row" data-perf-row="assistant_text">first</div>'),
			element('<div data-testid="transcript-row" data-perf-row="assistant_text" data-perf-last>last</div>'),
		);
		await paintAt(harness, 200);

		expect(queued(harness)).toStrictEqual([
			{journey: "F4", trigger: "navigation", start: 0, end: 70},
			{journey: "F3", trigger: "navigation", start: 0, end: 200},
		]);
	});

	it("ignores another session's rows", async () => {
		const harness = makeJourneyHarness({pathname: "/session/abc-123"});
		startLaunchJourneys("/session/abc-123", harness.tracker);
		document.body.append(sessionView("other", 2));
		await paintAt(harness, 70);

		expect(queued(harness)).toStrictEqual([]);
	});
});

describe("J3 session switch", () => {
	function sidebarRow(sessionId: string, queryClient: QueryClient, harness: JourneyHarness): HTMLElement {
		const row = element(`<a data-row-main-button href="/session/${sessionId}">Session</a>`);
		row.addEventListener("pointerdown", (event) =>
			startSessionSwitchJourney(event as PointerEvent, sessionId, queryClient, harness.tracker),
		);
		document.body.append(row);
		return row;
	}

	it("times F5 from the row's pointerdown to the new session's last row, recording a cold cache", async () => {
		const harness = makeJourneyHarness();
		const queryClient = new QueryClient();
		document.body.append(sessionView("old", 3));
		const row = sidebarRow("new", queryClient, harness);

		row.dispatchEvent(pointerDownAt(500));
		await paintAt(harness, 520);
		expect(queued(harness)).toStrictEqual([]);

		document.body.querySelector('[data-perf-session="old"]')!.remove();
		document.body.append(sessionView("new", 4));
		await paintAt(harness, 640);

		expect(queued(harness)).toStrictEqual([
			{journey: "F5", trigger: "pointerdown", start: 500, end: 640, prefetchHit: false},
		]);
	});

	it("records prefetchHit when the hover prefetch already cached the detail and transcript", async () => {
		const harness = makeJourneyHarness();
		const queryClient = new QueryClient();
		queryClient.setQueryData(sessionQueryKeys.detail("new"), {title: "New"});
		queryClient.setQueryData(sessionQueryKeys.transcript("new"), {records: []});
		const row = sidebarRow("new", queryClient, harness);

		row.dispatchEvent(pointerDownAt(500));
		document.body.append(sessionView("new", 1));
		await paintAt(harness, 560);

		expect(queued(harness)).toStrictEqual([
			{journey: "F5", trigger: "pointerdown", start: 500, end: 560, prefetchHit: true},
		]);
	});

	it("starts no journey for a modified or secondary click, or for the session already open", async () => {
		const harness = makeJourneyHarness();
		const queryClient = new QueryClient();
		document.body.append(sessionView("open", 2));
		const other = sidebarRow("new", queryClient, harness);
		const current = sidebarRow("open", queryClient, harness);

		other.dispatchEvent(pointerDownAt(10, {metaKey: true}));
		other.dispatchEvent(pointerDownAt(20, {shiftKey: true}));
		other.dispatchEvent(pointerDownAt(30, {button: 2}));
		current.dispatchEvent(pointerDownAt(40));
		document.body.append(sessionView("new", 1));
		await paintAt(harness, 100);

		expect(queued(harness)).toStrictEqual([]);
	});
});
