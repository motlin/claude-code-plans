// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {
	deriveFormFactor,
	deriveOrigin,
	endJourneyWhenRendered,
	PERF_ANCHORS,
	startJourney,
} from "../../src/lib/perf/journey";
import {
	flushMicrotasks,
	makeJourneyHarness as makeHarness,
	pointerDownAt,
	setDocumentVisibility,
	useJourneyHarnessLifecycle,
} from "./harness/journey-harness";

useJourneyHarnessLifecycle();

describe("deriveOrigin", () => {
	it("classifies loopback hostnames as localhost and everything else as remote", () => {
		expect(
			[
				"localhost",
				"127.0.0.1",
				"127.1.2.3",
				"[::1]",
				"::1",
				"app.localhost",
				"plans.m4.notlin.com",
				"192.168.1.5",
			].map((hostname) => [hostname, deriveOrigin(hostname)]),
		).toStrictEqual([
			["localhost", "localhost"],
			["127.0.0.1", "localhost"],
			["127.1.2.3", "localhost"],
			["[::1]", "localhost"],
			["::1", "localhost"],
			["app.localhost", "localhost"],
			["plans.m4.notlin.com", "remote"],
			["192.168.1.5", "remote"],
		]);
	});
});

describe("deriveFormFactor", () => {
	it("is phone for a coarse pointer or a viewport under 768px, otherwise desktop", () => {
		expect([
			deriveFormFactor({coarsePointer: true, viewportWidth: 1440}),
			deriveFormFactor({coarsePointer: false, viewportWidth: 767}),
			deriveFormFactor({coarsePointer: false, viewportWidth: 768}),
			deriveFormFactor({coarsePointer: false, viewportWidth: 1440}),
		]).toStrictEqual(["phone", "phone", "desktop", "desktop"]);
	});
});

describe("journey tracker", () => {
	it("waits for the anchor to exist with data, then ends on the rAF+setTimeout paint", async () => {
		const harness = makeHarness();
		harness.tracker.startJourney("J3", {trigger: pointerDownAt(100)});
		const done = harness.tracker.endJourneyWhenRendered("J3", '[data-perf-region="main"]');

		const main = document.createElement("div");
		main.setAttribute("data-perf-region", "main");
		document.body.append(main);
		await flushMicrotasks();
		expect(harness.frames).toHaveLength(0);

		main.append(document.createElement("div"));
		await flushMicrotasks();
		expect(harness.frames).toHaveLength(1);

		harness.performance.clock = 250;
		harness.runFrame();
		const sample = await done;

		expect({
			journey: sample?.journey,
			start: sample?.start,
			end: sample?.end,
			duration: sample?.duration,
			endSource: sample?.endSource,
			trigger: sample?.trigger,
			marks: harness.performance.marks,
			measures: harness.performance.measures,
		}).toStrictEqual({
			journey: "J3",
			start: 100,
			end: 250,
			duration: 150,
			endSource: "raf",
			trigger: "pointerdown",
			marks: [
				{name: "ccb:J3:start", startTime: 100},
				{name: "ccb:J3:end", startTime: 250},
			],
			measures: [{name: "ccb:J3", start: 100, end: 250}],
		});
	});

	it("prefers the Element Timing renderTime for the anchor", async () => {
		const harness = makeHarness();
		const row = document.createElement("div");
		row.setAttribute("data-testid", "transcript-row");
		row.setAttribute("data-perf-row", "assistant_text");
		row.setAttribute("elementtiming", "turn");
		row.textContent = "hello";

		harness.tracker.startJourney("J3", {trigger: pointerDownAt(10)});
		const done = harness.tracker.endJourneyWhenRendered("J3", PERF_ANCHORS.transcriptRow);
		document.body.append(row);
		await flushMicrotasks();
		harness.observers.emit("element", [{element: row, renderTime: 80, loadTime: 0, startTime: 80}]);
		harness.performance.clock = 95;
		harness.runFrame();

		expect(await done).toMatchObject({end: 80, duration: 70, endSource: "element-timing"});
	});

	it("attaches build, origin, form factor, route and entries inside the window", async () => {
		const harness = makeHarness({
			hostname: "plans.m4.notlin.com",
			matchesCoarsePointer: () => true,
			mode: "prod",
		});
		const main = document.createElement("div");
		main.setAttribute("data-perf-region", "main");
		main.textContent = "ready";
		document.body.append(main);

		harness.tracker.startJourney("J2", {trigger: "navigation", sizeBytes: 2_000_000});
		harness.observers.emit("resource", [
			{
				name: "http://plans/api/sessions/abc/transcript",
				initiatorType: "fetch",
				startTime: 5,
				duration: 30,
				requestStart: 6,
				responseStart: 20,
				responseEnd: 35,
				transferSize: 1234,
				serverTiming: [{name: "total", duration: 12, description: ""}],
			},
		]);
		harness.observers.emit("long-animation-frame", [
			{
				startTime: 40,
				duration: 70,
				blockingDuration: 20,
				scripts: [{invoker: "click", sourceURL: "app.js", sourceFunctionName: "f", duration: 50}],
			},
		]);
		harness.observers.emit("layout-shift", [
			{startTime: 45, value: 0.1, hadRecentInput: false},
			{startTime: 46, value: 0.5, hadRecentInput: true},
			{startTime: 500, value: 0.3, hadRecentInput: false},
		]);
		harness.observers.emit("event", [
			{
				name: "pointerdown",
				startTime: 2,
				duration: 24,
				processingStart: 3,
				processingEnd: 9,
				interactionId: 7,
			},
		]);

		const done = harness.tracker.endJourneyWhenRendered("J2", '[data-perf-region="main"]');
		await flushMicrotasks();
		harness.performance.clock = 120;
		harness.runFrame();

		expect(await done).toStrictEqual({
			journey: "J2",
			trigger: "navigation",
			start: 0,
			end: 120,
			duration: 120,
			endSource: "raf",
			route: "/session/abc",
			sizeBucket: "M",
			buildSha: "abc1234",
			mode: "prod",
			origin: "remote",
			formFactor: "phone",
			hardwareConcurrency: 8,
			resources: [
				{
					name: "http://plans/api/sessions/abc/transcript",
					initiatorType: "fetch",
					startTime: 5,
					duration: 30,
					requestStart: 6,
					responseStart: 20,
					responseEnd: 35,
					transferSize: 1234,
					serverTiming: [{name: "total", duration: 12, description: ""}],
				},
			],
			longAnimationFrames: [
				{
					startTime: 40,
					duration: 70,
					blockingDuration: 20,
					scripts: [{invoker: "click", sourceURL: "app.js", sourceFunctionName: "f", duration: 50}],
				},
			],
			layoutShifts: [
				{startTime: 45, value: 0.1, hadRecentInput: false},
				{startTime: 46, value: 0.5, hadRecentInput: true},
			],
			cls: 0.1,
			events: [
				{
					name: "pointerdown",
					startTime: 2,
					duration: 24,
					processingStart: 3,
					processingEnd: 9,
					interactionId: 7,
				},
			],
		});
	});

	it("derives localhost origin and a desktop form factor, or phone for a narrow viewport", async () => {
		const desktop = makeHarness();
		const narrow = makeHarness({hostname: "127.0.0.1", viewportWidth: () => 600});
		const main = document.createElement("div");
		main.setAttribute("data-perf-region", "main");
		main.textContent = "ready";
		document.body.append(main);

		const results = [];
		for (const harness of [desktop, narrow]) {
			harness.tracker.startJourney("J1", {trigger: "navigation"});
			const done = harness.tracker.endJourneyWhenRendered("J1", '[data-perf-region="main"]');
			await flushMicrotasks();
			harness.runFrame();
			const sample = await done;
			results.push([sample?.origin, sample?.formFactor]);
		}

		expect(results).toStrictEqual([
			["localhost", "desktop"],
			["localhost", "phone"],
		]);
	});

	it("waits for every anchor of a multi-anchor journey before ending it", async () => {
		const harness = makeHarness();
		harness.tracker.startJourney("F1", {trigger: "navigation"});
		const done = harness.tracker.endJourneyWhenRendered("F1", [
			'[data-perf-region="sidebar_recents"]',
			'[data-perf-region="main"]',
		]);

		const recents = document.createElement("div");
		recents.setAttribute("data-perf-region", "sidebar_recents");
		recents.textContent = "row";
		document.body.append(recents);
		await flushMicrotasks();
		harness.runFrame();
		expect(harness.frames).toHaveLength(0);

		const main = document.createElement("div");
		main.setAttribute("data-perf-region", "main");
		main.textContent = "rows";
		document.body.append(main);
		await flushMicrotasks();
		harness.performance.clock = 300;
		harness.runFrame();

		expect(await done).toMatchObject({journey: "F1", start: 0, end: 300, endSource: "raf"});
	});

	it("attaches prefetchHit to the sample only when the journey was started with it", async () => {
		const harness = makeHarness();
		const main = document.createElement("div");
		main.setAttribute("data-perf-region", "main");
		main.textContent = "ready";
		document.body.append(main);

		const results = [];
		for (const prefetchHit of [true, false, undefined]) {
			harness.tracker.startJourney("F5", {
				trigger: pointerDownAt(5),
				...(prefetchHit === undefined ? {} : {prefetchHit}),
			});
			const done = harness.tracker.endJourneyWhenRendered("F5", '[data-perf-region="main"]');
			await flushMicrotasks();
			harness.runFrame();
			const sample = await done;
			results.push(sample !== null && "prefetchHit" in sample ? sample.prefetchHit : "absent");
		}

		expect(results).toStrictEqual([true, false, "absent"]);
	});

	it("drops a sample whose tab was hidden at any point during the journey", async () => {
		const harness = makeHarness();
		harness.tracker.startJourney("J3", {trigger: pointerDownAt(100)});
		const done = harness.tracker.endJourneyWhenRendered("J3", '[data-perf-region="main"]');
		harness.setVisibility("hidden");
		harness.setVisibility("visible");

		const main = document.createElement("div");
		main.setAttribute("data-perf-region", "main");
		main.textContent = "ready";
		document.body.append(main);
		await flushMicrotasks();
		harness.runFrame();

		expect(await done).toBeNull();
		harness.tracker.flush();
		expect(harness.sent).toStrictEqual([]);
	});

	it("queues samples and flushes the batch when the tab becomes hidden", async () => {
		const harness = makeHarness();
		const main = document.createElement("div");
		main.setAttribute("data-perf-region", "main");
		main.textContent = "ready";
		document.body.append(main);

		for (const id of ["J1", "J3"]) {
			harness.tracker.startJourney(id, {trigger: "navigation"});
			const done = harness.tracker.endJourneyWhenRendered(id, '[data-perf-region="main"]');
			await flushMicrotasks();
			harness.runFrame();
			await done;
		}
		expect(harness.sent).toStrictEqual([]);

		harness.setVisibility("hidden");

		expect(harness.sent.map((batch) => batch.map((sample) => sample.journey))).toStrictEqual([["J1", "J3"]]);
		harness.setVisibility("visible");
		harness.setVisibility("hidden");
		expect(harness.sent).toHaveLength(1);
	});
});

describe("default browser tracker", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("times a journey against the real window and beacons the batch to /api/perf on hide", async () => {
		const sendBeacon = vi.fn((_path: string, _body: string) => true);
		vi.stubGlobal("navigator", {sendBeacon, hardwareConcurrency: 4});
		const row = document.createElement("div");
		row.setAttribute("data-testid", "transcript-row");
		row.setAttribute("data-perf-row", "assistant_text");
		row.textContent = "hello";
		document.body.append(row);

		startJourney("J2", {trigger: "navigation"});
		const sample = await endJourneyWhenRendered("J2", PERF_ANCHORS.transcriptRow);
		setDocumentVisibility("hidden");

		expect({
			journey: sample?.journey,
			trigger: sample?.trigger,
			route: sample?.route,
			origin: sample?.origin,
			formFactor: sample?.formFactor,
			buildSha: sample?.buildSha,
			mode: sample?.mode,
			beacons: sendBeacon.mock.calls.map(([path, body]) => [path, JSON.parse(body).samples.length]),
		}).toStrictEqual({
			journey: "J2",
			trigger: "navigation",
			route: "/",
			origin: "localhost",
			formFactor: "desktop",
			buildSha: "unknown",
			mode: "dev",
			beacons: [["/api/perf", 1]],
		});
	});
});
