import {afterEach, beforeEach} from "vite-plus/test";
import {
	createJourneyTracker,
	type JourneyEnvironment,
	type JourneySample,
	type JourneyTracker,
} from "../../../src/lib/perf/journey";

class FakePerformance {
	clock = 0;
	readonly marks: {name: string; startTime: number | undefined}[] = [];
	readonly measures: {name: string; start: number; end: number}[] = [];

	now(): number {
		return this.clock;
	}

	mark(name: string, options?: {startTime?: number}): void {
		this.marks.push({name, startTime: options?.startTime});
	}

	measure(name: string, options: {start: number; end: number}): void {
		this.measures.push({name, start: options.start, end: options.end});
	}
}

class FakeObserverHub {
	private readonly callbacks = new Map<string, ((entries: PerformanceEntry[]) => void)[]>();

	readonly Observer = fakeObserverClass(this.callbacks);

	emit(type: string, entries: object[]): void {
		for (const callback of this.callbacks.get(type) ?? []) callback(entries as PerformanceEntry[]);
	}
}

function fakeObserverClass(callbacks: Map<string, ((entries: PerformanceEntry[]) => void)[]>) {
	return class {
		constructor(private readonly callback: PerformanceObserverCallback) {}

		observe(options: {type: string}): void {
			const list = callbacks.get(options.type) ?? [];
			list.push((entries) =>
				this.callback({getEntries: () => entries} as PerformanceObserverEntryList, this as never),
			);
			callbacks.set(options.type, list);
		}

		disconnect(): void {}
	};
}

export interface JourneyHarness {
	tracker: JourneyTracker;
	performance: FakePerformance;
	observers: FakeObserverHub;
	sent: JourneySample[][];
	frames: (() => void)[];
	timers: (() => void)[];
	runFrame(): void;
	setVisibility(state: DocumentVisibilityState): void;
}

let visibility: DocumentVisibilityState = "visible";
const trackers: JourneyTracker[] = [];

/** Resets the document's visibility and body before each test and disposes every harness tracker after it. */
export function useJourneyHarnessLifecycle(): void {
	beforeEach(() => {
		visibility = "visible";
		Object.defineProperty(document, "visibilityState", {configurable: true, get: () => visibility});
		document.body.innerHTML = "";
	});

	afterEach(() => {
		for (const tracker of trackers.splice(0)) tracker.dispose();
	});
}

export function setDocumentVisibility(state: DocumentVisibilityState): void {
	visibility = state;
	document.dispatchEvent(new Event("visibilitychange"));
}

/** A tracker over a fake clock, fake observers and manually stepped rAF/timers, recording every sent batch. */
export function makeJourneyHarness(overrides: Partial<JourneyEnvironment> = {}): JourneyHarness {
	const performance = new FakePerformance();
	const observers = new FakeObserverHub();
	const sent: JourneySample[][] = [];
	const frames: (() => void)[] = [];
	const timers: (() => void)[] = [];
	const environment: JourneyEnvironment = {
		document,
		performance: performance as unknown as Performance,
		PerformanceObserver: observers.Observer as unknown as typeof PerformanceObserver,
		hostname: "localhost",
		pathname: "/session/abc",
		matchesCoarsePointer: () => false,
		viewportWidth: () => 1440,
		hardwareConcurrency: 8,
		buildSha: "abc1234",
		mode: "dev",
		requestAnimationFrame: (callback) => {
			frames.push(() => callback(performance.clock));
			return frames.length;
		},
		// Only zero-delay timers are part of a frame; the 30 s anchor timeout never fires on its own.
		setTimeout: (callback, ms) => {
			if (ms !== undefined && ms > 0) return 0;
			timers.push(callback);
			return timers.length;
		},
		setInterval: () => 0,
		clearInterval: () => {},
		send: (batch) => {
			sent.push(batch);
		},
		...overrides,
	};
	const tracker = createJourneyTracker(environment);
	trackers.push(tracker);
	return {
		tracker,
		performance,
		observers,
		sent,
		frames,
		timers,
		runFrame() {
			for (const frame of frames.splice(0)) frame();
			for (const timer of timers.splice(0)) timer();
		},
		setVisibility: setDocumentVisibility,
	};
}

export function pointerDownAt(timeStamp: number, init: MouseEventInit = {}): Event {
	const event = new MouseEvent("pointerdown", {button: 0, bubbles: true, ...init});
	Object.defineProperty(event, "timeStamp", {value: timeStamp});
	return event;
}

export async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}
