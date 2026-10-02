// @vitest-environment jsdom

import {QueryClient} from "@tanstack/react-query";
import {describe, expect, it} from "vite-plus/test";
import {sessionQueryKeys} from "../../src/lib/api/sessions";
import {
	startComposerKeystrokeJourney,
	startComposerSubmitJourneys,
	startLaunchJourneys,
	startLiveAppendJourneys,
	startPaletteOpenJourney,
	startPaletteSearchJourney,
	startSessionSwitchJourney,
} from "../../src/lib/perf/field-journeys";
import type {JourneySample} from "../../src/lib/perf/journey";
import {
	flushMicrotasks,
	keyDownAt,
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
		...(sample.endSource === "event-timing" ? {endSource: sample.endSource} : {}),
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
	it.each([
		{launchId: "session_alice_100", label: "an alias resolves to a local UUID"},
		{launchId: "session-alice", label: "a UUID URL becomes its canonical alias"},
	])("retains navigation timing when $label", async ({launchId}) => {
		const pathname = `/session/${launchId}`;
		const harness = makeJourneyHarness({pathname});
		harness.performance.clock = 50;
		startLaunchJourneys(pathname, harness.tracker);

		const other = sessionView("session-bob", 2);
		other.setAttribute("data-perf-session-route", "session_bob_200");
		document.body.append(other);
		await paintAt(harness, 70);
		const beforeResolution = queued(harness);

		const view = sessionView("session-alice", 3);
		view.setAttribute("data-perf-session-route", "session_alice_100");
		document.body.append(view);
		await paintAt(harness, 180);
		expect({beforeResolution, rendered: queued(harness)}).toStrictEqual({
			beforeResolution: [],
			rendered: [
				{journey: "F3", trigger: "navigation", start: 0, end: 180},
				{journey: "F4", trigger: "navigation", start: 0, end: 180},
			],
		});
	});

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

/** A transcript row for the JSONL record at `line`. */
function transcriptRow(line: number, kind = "assistant_text"): HTMLElement {
	return element(
		`<div data-testid="transcript-row" data-perf-row="${kind}" data-perf-line="${line}">line ${line}</div>`,
	);
}

function liveSession(sessionId: string, lines: number[]): HTMLElement {
	const view = element(`<div data-perf-session="${sessionId}"><div data-transcript></div></div>`);
	view.querySelector("[data-transcript]")!.append(...lines.map((line) => transcriptRow(line)));
	document.body.append(view);
	return view;
}

function sseEventAt(timeStamp: number): Event {
	const event = new MessageEvent("session:lines-appended", {data: "{}"});
	Object.defineProperty(event, "timeStamp", {value: timeStamp});
	return event;
}

const userPrompt = {type: "user", message: {role: "user", content: "Ship it"}};
const assistantText = {type: "assistant", message: {role: "assistant", content: [{type: "text", text: "Done"}]}};
const toolResult = {
	type: "user",
	message: {role: "user", content: [{type: "tool_result", tool_use_id: "t1", content: "ok"}]},
};

describe("J4 live update", () => {
	it("times F6 from the JSONL write and F7 from SSE receipt to the appended line's row painting", async () => {
		// The harness clock's navigation start is epoch 1_000_000, so writtenAt 1_000_700 is t=700.
		const harness = makeJourneyHarness();
		const view = liveSession("live", [10, 11]);

		startLiveAppendJourneys(
			sseEventAt(900),
			{sessionId: "live", writtenAt: 1_000_700, lines: [assistantText]},
			12,
			harness.tracker,
		);
		await paintAt(harness, 950);
		expect(queued(harness)).toStrictEqual([]);

		view.querySelector("[data-transcript]")!.append(transcriptRow(12));
		await paintAt(harness, 980);

		expect(queued(harness)).toStrictEqual([
			{journey: "F6", trigger: "jsonl-write", start: 700, end: 980},
			{journey: "F7", trigger: "session:lines-appended", start: 900, end: 980},
		]);
	});

	it("starts no live journey for a session that is not on screen", async () => {
		const harness = makeJourneyHarness();
		liveSession("other", [12]);

		startLiveAppendJourneys(
			sseEventAt(900),
			{sessionId: "live", writtenAt: 1_000_700, lines: [assistantText]},
			12,
			harness.tracker,
		);
		await paintAt(harness, 980);

		expect(queued(harness)).toStrictEqual([]);
	});
});

describe("J5 composer", () => {
	it("times F8 from a composer keydown to the next paint, preferring its Event Timing entry", async () => {
		const harness = makeJourneyHarness();
		startComposerKeystrokeJourney(keyDownAt(100, {key: "a"}), harness.tracker);
		await paintAt(harness, 112);

		startComposerKeystrokeJourney(keyDownAt(200, {key: "b"}), harness.tracker);
		harness.observers.emit("event", [
			{name: "keydown", startTime: 200, duration: 32, processingStart: 201, processingEnd: 220, interactionId: 3},
		]);
		await paintAt(harness, 240);

		expect(queued(harness)).toStrictEqual([
			{journey: "F8", trigger: "keydown", start: 100, end: 112},
			{journey: "F8", trigger: "keydown", start: 200, end: 232, endSource: "event-timing"},
		]);
	});

	it("ignores keydowns that are part of an IME composition", async () => {
		const harness = makeJourneyHarness();
		startComposerKeystrokeJourney(keyDownAt(100, {key: "a", isComposing: true}), harness.tracker);
		await paintAt(harness, 112);

		expect(queued(harness)).toStrictEqual([]);
	});

	it("times F9 from submit to the pending prompt row, then F10 to the prompt's own row from SSE", async () => {
		const harness = makeJourneyHarness();
		const view = liveSession("live", [10, 11]);

		startComposerSubmitJourneys(keyDownAt(1000, {key: "Enter"}), "live", harness.tracker);
		await paintAt(harness, 1010);
		expect(queued(harness)).toStrictEqual([]);

		view.append(element('<div data-perf-pending-prompt="">Ship it</div>'));
		await paintAt(harness, 1030);
		expect(queued(harness)).toStrictEqual([{journey: "F9", trigger: "keydown", start: 1000, end: 1030}]);

		// A tool result for an earlier turn lands first: no row of its own and not the prompt.
		startLiveAppendJourneys(
			sseEventAt(1500),
			{sessionId: "live", writtenAt: 1_001_400, lines: [toolResult]},
			12,
			harness.tracker,
		);
		await paintAt(harness, 1520);

		startLiveAppendJourneys(
			sseEventAt(2500),
			{sessionId: "live", writtenAt: 1_002_400, lines: [userPrompt]},
			13,
			harness.tracker,
		);
		view.querySelector("[data-transcript]")!.append(transcriptRow(13, "human"));
		await paintAt(harness, 2600);

		expect(queued(harness)).toStrictEqual([
			{journey: "F9", trigger: "keydown", start: 1000, end: 1030},
			{journey: "F6", trigger: "jsonl-write", start: 2400, end: 2600},
			{journey: "F7", trigger: "session:lines-appended", start: 2500, end: 2600},
			{journey: "F10", trigger: "keydown", start: 1000, end: 2600},
		]);
	});

	it("skips F9 while an earlier pending prompt is still on screen, but still times F10", async () => {
		const harness = makeJourneyHarness();
		const view = liveSession("live", [10]);
		view.append(element('<div data-perf-pending-prompt="">Earlier</div>'));

		startComposerSubmitJourneys(keyDownAt(1000, {key: "Enter"}), "live", harness.tracker);
		await paintAt(harness, 1030);
		startLiveAppendJourneys(
			sseEventAt(2500),
			{sessionId: "live", writtenAt: 1_002_400, lines: [userPrompt]},
			11,
			harness.tracker,
		);
		view.querySelector("[data-transcript]")!.append(transcriptRow(11, "human"));
		await paintAt(harness, 2600);

		expect(queued(harness).map((sample) => sample.journey)).toStrictEqual(["F6", "F7", "F10"]);
	});
});

describe("J6 command palette", () => {
	const palette = (rows: string) =>
		element(`<div data-perf-overlay="command_palette"><div cmdk-list="">${rows}</div></div>`);

	it("times F11 from the shortcut keydown to the palette painting with rows", async () => {
		const harness = makeJourneyHarness();
		startPaletteOpenJourney(keyDownAt(400, {key: "k", metaKey: true}), harness.tracker);

		const popup = palette("");
		document.body.append(popup);
		await paintAt(harness, 420);
		expect(queued(harness)).toStrictEqual([]);

		popup.querySelector("[cmdk-list]")!.append(element('<div cmdk-item="">Recent session</div>'));
		await paintAt(harness, 450);

		expect(queued(harness)).toStrictEqual([{journey: "F11", trigger: "keydown", start: 400, end: 450}]);
	});

	it("starts no F11 when the shortcut closes an open palette", async () => {
		const harness = makeJourneyHarness();
		document.body.append(palette('<div cmdk-item="">Recent session</div>'));
		startPaletteOpenJourney(keyDownAt(400, {key: "k", metaKey: true}), harness.tracker);
		await paintAt(harness, 450);

		expect(queued(harness)).toStrictEqual([]);
	});

	it("times F12 from a query-editing keydown to the results painting, ignoring navigation and chords", async () => {
		const harness = makeJourneyHarness();
		document.body.append(palette('<div cmdk-item="">Recent session</div>'));

		startPaletteSearchJourney(keyDownAt(500, {key: "ArrowDown"}), harness.tracker);
		startPaletteSearchJourney(keyDownAt(510, {key: "a", metaKey: true}), harness.tracker);
		await paintAt(harness, 520);
		startPaletteSearchJourney(keyDownAt(600, {key: "s"}), harness.tracker);
		await paintAt(harness, 630);
		startPaletteSearchJourney(keyDownAt(700, {key: "Backspace"}), harness.tracker);
		await paintAt(harness, 720);

		expect(queued(harness)).toStrictEqual([
			{journey: "F12", trigger: "keydown", start: 600, end: 630},
			{journey: "F12", trigger: "keydown", start: 700, end: 720},
		]);
	});
});
