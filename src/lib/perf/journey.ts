// Field journey timing (plan .llm/perf/measurement-plan.md §2.1, §2.2, §4.5). A journey starts at the triggering
// event's timeStamp (or navigation start) and ends at the paint after its anchor element exists with data. Each
// sample carries the performance entries inside its window plus the build, origin and form-factor buckets that
// `just perf-report` splits p75 by. Samples from a tab that was ever hidden are dropped: hidden tabs throttle rAF and
// timers, so their wall-clock numbers are meaningless.

/**
 * Anchor selectors for journey ends. Transcript rows carry upstream's `[data-testid=transcript-row]` with a per-type
 * `data-perf-row` (human, assistant_text, assistant_tool, assistant_thinking, assistant, marker); the "Initialized
 * session" row is a `marker` too, so the working marker is the one outside the transcript rows.
 */
export const PERF_ANCHORS = {
	main: '[data-perf-region="main"]',
	header: '[data-perf-region="header"]',
	sidebarRecents: '[data-perf-region="sidebar_recents"]',
	sidebarPinned: '[data-perf-region="sidebar_pinned"]',
	sidePane: '[data-perf-region="side_pane"]',
	transcriptRow: '[data-testid="transcript-row"]',
	lastTranscriptRow: '[data-testid="transcript-row"][data-perf-last]',
	sidebarRecentsRow: '[data-perf-region="sidebar_recents"] [data-row-main-button]',
	homeSections: "[data-home-action-center][data-perf-ready]",
	workingMarker: '[data-perf-row="marker"]:not([data-testid="transcript-row"])',
	commandPalette: '[data-perf-overlay="command_palette"]',
} as const;

const PERF_BEACON_PATH = "/api/perf";

const FLUSH_INTERVAL_MS = 30_000;
const ANCHOR_TIMEOUT_MS = 30_000;
const ENTRY_BUFFER_LIMIT = 500;
const PHONE_MAX_WIDTH = 768;

export type Origin = "localhost" | "remote";
export type FormFactor = "phone" | "desktop";
export type SizeBucket = "S" | "M" | "L";
export type EndSource = "element-timing" | "raf";

export interface ResourceSample {
	name: string;
	initiatorType: string;
	startTime: number;
	duration: number;
	requestStart: number;
	responseStart: number;
	responseEnd: number;
	transferSize: number;
	serverTiming: {name: string; duration: number; description: string}[];
}

export interface LongAnimationFrameSample {
	startTime: number;
	duration: number;
	blockingDuration: number;
	scripts: {invoker: string; sourceURL: string; sourceFunctionName: string; duration: number}[];
}

export interface LayoutShiftSample {
	startTime: number;
	value: number;
	hadRecentInput: boolean;
}

export interface EventTimingSample {
	name: string;
	startTime: number;
	duration: number;
	processingStart: number;
	processingEnd: number;
	interactionId: number;
}

export interface JourneySample {
	journey: string;
	trigger: string;
	start: number;
	end: number;
	duration: number;
	endSource: EndSource;
	route: string;
	sizeBucket?: SizeBucket;
	/** Session switch only: whether the hover prefetch had already cached the session when the pointer went down. */
	prefetchHit?: boolean;
	buildSha: string;
	mode: "dev" | "prod";
	origin: Origin;
	formFactor: FormFactor;
	hardwareConcurrency: number;
	resources: ResourceSample[];
	longAnimationFrames: LongAnimationFrameSample[];
	layoutShifts: LayoutShiftSample[];
	cls: number;
	events: EventTimingSample[];
}

export interface JourneyEnvironment {
	document: Document;
	performance: Performance;
	PerformanceObserver: typeof PerformanceObserver | undefined;
	hostname: string;
	pathname: string;
	matchesCoarsePointer: () => boolean;
	viewportWidth: () => number;
	hardwareConcurrency: number;
	buildSha: string;
	mode: "dev" | "prod";
	requestAnimationFrame: (callback: FrameRequestCallback) => number;
	setTimeout: (callback: () => void, ms?: number) => unknown;
	setInterval: (callback: () => void, ms: number) => unknown;
	clearInterval: (handle: unknown) => void;
	send: (batch: JourneySample[]) => void;
}

export interface StartJourneyOptions {
	/** The interaction that caused the journey, or "navigation" for journeys timed from navigation start. */
	trigger: Event | "navigation";
	/** Session JSONL bytes, bucketed into S (< 1 MB), M (1–10 MB) and L (> 10 MB). */
	sizeBytes?: number;
	/** Whether the hover prefetch had already warmed the cache the journey reads. */
	prefetchHit?: boolean;
}

/** One anchor selector, or several that must all match an element with data before the journey ends. */
export type AnchorSelector = string | readonly string[];

export interface JourneyTracker {
	startJourney(id: string, options: StartJourneyOptions): void;
	/** Resolves with the queued sample, or null when the journey was hidden, unknown, superseded or timed out. */
	endJourneyWhenRendered(id: string, anchorSelector: AnchorSelector): Promise<JourneySample | null>;
	flush(): void;
	dispose(): void;
}

interface ActiveJourney {
	trigger: string;
	start: number;
	route: string;
	sizeBucket: SizeBucket | undefined;
	prefetchHit: boolean | undefined;
	hidden: boolean;
}

export function deriveOrigin(hostname: string): Origin {
	const host = hostname.replace(/^\[|\]$/g, "");
	const loopback =
		host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
	return loopback ? "localhost" : "remote";
}

export function deriveFormFactor({
	coarsePointer,
	viewportWidth,
}: {
	coarsePointer: boolean;
	viewportWidth: number;
}): FormFactor {
	return coarsePointer || viewportWidth < PHONE_MAX_WIDTH ? "phone" : "desktop";
}

function sizeBucket(bytes: number): SizeBucket {
	if (bytes < 1_000_000) return "S";
	return bytes <= 10_000_000 ? "M" : "L";
}

function hasData(element: Element): boolean {
	return element.childElementCount > 0 || (element.textContent ?? "").trim() !== "";
}

function findAnchor(document: Document, selector: string): Element | null {
	for (const element of document.querySelectorAll(selector)) {
		if (hasData(element)) return element;
	}
	return null;
}

function toResource(entry: PerformanceResourceTiming): ResourceSample {
	return {
		name: entry.name,
		initiatorType: entry.initiatorType,
		startTime: entry.startTime,
		duration: entry.duration,
		requestStart: entry.requestStart,
		responseStart: entry.responseStart,
		responseEnd: entry.responseEnd,
		transferSize: entry.transferSize,
		serverTiming: (entry.serverTiming ?? []).map(({name, duration, description}) => ({
			name,
			duration,
			description,
		})),
	};
}

interface RawLongAnimationFrame {
	startTime: number;
	duration: number;
	blockingDuration: number;
	scripts?: {invoker: string; sourceURL: string; sourceFunctionName: string; duration: number}[];
}

function toLongAnimationFrame(entry: RawLongAnimationFrame): LongAnimationFrameSample {
	return {
		startTime: entry.startTime,
		duration: entry.duration,
		blockingDuration: entry.blockingDuration,
		scripts: (entry.scripts ?? []).map(({invoker, sourceURL, sourceFunctionName, duration}) => ({
			invoker,
			sourceURL,
			sourceFunctionName,
			duration,
		})),
	};
}

function toLayoutShift(entry: LayoutShiftSample): LayoutShiftSample {
	return {startTime: entry.startTime, value: entry.value, hadRecentInput: entry.hadRecentInput};
}

function toEventTiming(entry: PerformanceEventTiming): EventTimingSample {
	return {
		name: entry.name,
		startTime: entry.startTime,
		duration: entry.duration,
		processingStart: entry.processingStart,
		processingEnd: entry.processingEnd,
		interactionId: entry.interactionId,
	};
}

interface ElementTimingEntry {
	element: Element | null;
	renderTime: number;
}

const OBSERVED_TYPES = ["resource", "long-animation-frame", "layout-shift", "event", "element"] as const;
type ObservedType = (typeof OBSERVED_TYPES)[number];

export function createJourneyTracker(environment: JourneyEnvironment): JourneyTracker {
	const {document, performance} = environment;
	const buffers = new Map<ObservedType, PerformanceEntry[]>(OBSERVED_TYPES.map((type) => [type, []]));
	const observers: PerformanceObserver[] = [];
	const active = new Map<string, ActiveJourney>();
	const cancelWaits = new Set<() => void>();
	let queue: JourneySample[] = [];
	let flushTimer: unknown;

	if (environment.PerformanceObserver) {
		for (const type of OBSERVED_TYPES) {
			try {
				const observer = new environment.PerformanceObserver((list) => {
					const buffer = buffers.get(type)!;
					buffer.push(...list.getEntries());
					if (buffer.length > ENTRY_BUFFER_LIMIT) buffer.splice(0, buffer.length - ENTRY_BUFFER_LIMIT);
				});
				observer.observe({type, buffered: true, ...(type === "event" ? {durationThreshold: 16} : {})});
				observers.push(observer);
			} catch {
				// Entry types this browser does not support are simply missing from the samples.
			}
		}
	}

	function flush(): void {
		if (queue.length === 0) return;
		const batch = queue;
		queue = [];
		environment.send(batch);
	}

	function onVisibilityChange(): void {
		if (document.visibilityState !== "hidden") return;
		for (const journey of active.values()) journey.hidden = true;
		flush();
	}
	document.addEventListener("visibilitychange", onVisibilityChange);

	function enqueue(sample: JourneySample): void {
		queue.push(sample);
		flushTimer ??= environment.setInterval(flush, FLUSH_INTERVAL_MS);
	}

	function entriesBetween<T extends PerformanceEntry>(type: ObservedType, start: number, end: number): T[] {
		return buffers.get(type)!.filter((entry) => entry.startTime >= start && entry.startTime <= end) as T[];
	}

	function elementRenderTime(anchor: Element): number | undefined {
		const entries = buffers.get("element") as unknown as ElementTimingEntry[];
		return entries.find((entry) => entry.element === anchor && entry.renderTime > 0)?.renderTime;
	}

	function buildSample(id: string, journey: ActiveJourney, end: number, endSource: EndSource): JourneySample {
		const layoutShifts = entriesBetween<PerformanceEntry & LayoutShiftSample>(
			"layout-shift",
			journey.start,
			end,
		).map(toLayoutShift);
		return {
			journey: id,
			trigger: journey.trigger,
			start: journey.start,
			end,
			duration: end - journey.start,
			endSource,
			route: journey.route,
			...(journey.sizeBucket ? {sizeBucket: journey.sizeBucket} : {}),
			...(journey.prefetchHit === undefined ? {} : {prefetchHit: journey.prefetchHit}),
			buildSha: environment.buildSha,
			mode: environment.mode,
			origin: deriveOrigin(environment.hostname),
			formFactor: deriveFormFactor({
				coarsePointer: environment.matchesCoarsePointer(),
				viewportWidth: environment.viewportWidth(),
			}),
			hardwareConcurrency: environment.hardwareConcurrency,
			resources: entriesBetween<PerformanceResourceTiming>("resource", journey.start, end).map(toResource),
			longAnimationFrames: entriesBetween<PerformanceEntry & RawLongAnimationFrame>(
				"long-animation-frame",
				journey.start,
				end,
			).map(toLongAnimationFrame),
			layoutShifts,
			cls: layoutShifts.filter((shift) => !shift.hadRecentInput).reduce((sum, shift) => sum + shift.value, 0),
			events: entriesBetween<PerformanceEventTiming>("event", journey.start, end).map(toEventTiming),
		};
	}

	function findAnchors(selectors: readonly string[]): Element[] | null {
		const anchors: Element[] = [];
		for (const selector of selectors) {
			const anchor = findAnchor(document, selector);
			if (!anchor) return null;
			anchors.push(anchor);
		}
		return anchors;
	}

	function waitForAnchors(selectors: readonly string[]): Promise<Element[] | null> {
		const existing = findAnchors(selectors);
		if (existing) return Promise.resolve(existing);
		return new Promise((resolve) => {
			const mutationObserver = new MutationObserver(() => {
				const anchors = findAnchors(selectors);
				if (anchors) finish(anchors);
			});
			function finish(anchors: Element[] | null): void {
				mutationObserver.disconnect();
				cancelWaits.delete(cancel);
				resolve(anchors);
			}
			function cancel(): void {
				finish(null);
			}
			cancelWaits.add(cancel);
			environment.setTimeout(cancel, ANCHOR_TIMEOUT_MS);
			mutationObserver.observe(document, {
				childList: true,
				subtree: true,
				characterData: true,
				attributes: true,
			});
		});
	}

	function afterPaint(): Promise<number> {
		return new Promise((resolve) => {
			environment.requestAnimationFrame(() => {
				environment.setTimeout(() => resolve(performance.now()), 0);
			});
		});
	}

	return {
		startJourney(id, {trigger, sizeBytes, prefetchHit}) {
			const start = trigger === "navigation" ? 0 : trigger.timeStamp;
			active.set(id, {
				trigger: trigger === "navigation" ? "navigation" : trigger.type,
				start,
				route: environment.pathname,
				sizeBucket: sizeBytes === undefined ? undefined : sizeBucket(sizeBytes),
				prefetchHit,
				hidden: document.visibilityState === "hidden",
			});
			performance.mark(`ccb:${id}:start`, {startTime: start});
		},

		async endJourneyWhenRendered(id, anchorSelector) {
			const journey = active.get(id);
			if (!journey) return null;
			const anchors = await waitForAnchors(
				typeof anchorSelector === "string" ? [anchorSelector] : anchorSelector,
			);
			if (!anchors || active.get(id) !== journey) return null;
			const paintedAt = await afterPaint();
			if (active.get(id) !== journey) return null;
			active.delete(id);
			if (journey.hidden) return null;

			const renderTimes = anchors.map(elementRenderTime);
			const renderTime = renderTimes.every((time) => time !== undefined)
				? Math.max(...(renderTimes as number[]))
				: undefined;
			const end = renderTime ?? paintedAt;
			performance.mark(`ccb:${id}:end`, {startTime: end});
			performance.measure(`ccb:${id}`, {start: journey.start, end});
			const sample = buildSample(id, journey, end, renderTime === undefined ? "raf" : "element-timing");
			enqueue(sample);
			return sample;
		},

		flush,

		dispose() {
			document.removeEventListener("visibilitychange", onVisibilityChange);
			for (const observer of observers) observer.disconnect();
			for (const cancel of cancelWaits) cancel();
			if (flushTimer !== undefined) environment.clearInterval(flushTimer);
			active.clear();
			queue = [];
		},
	};
}

declare const __CCB_BUILD_SHA__: string | undefined;

function browserEnvironment(): JourneyEnvironment {
	return {
		document,
		performance,
		PerformanceObserver: typeof PerformanceObserver === "undefined" ? undefined : PerformanceObserver,
		hostname: location.hostname,
		get pathname() {
			return location.pathname;
		},
		matchesCoarsePointer: () => window.matchMedia?.("(pointer: coarse)").matches ?? false,
		viewportWidth: () => window.innerWidth,
		hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
		buildSha: typeof __CCB_BUILD_SHA__ === "string" ? __CCB_BUILD_SHA__ : "unknown",
		mode: import.meta.env.DEV ? "dev" : "prod",
		requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
		setTimeout: (callback, ms) => window.setTimeout(callback, ms),
		setInterval: (callback, ms) => window.setInterval(callback, ms),
		clearInterval: (handle) => window.clearInterval(handle as number),
		send: (batch) => {
			navigator.sendBeacon?.(PERF_BEACON_PATH, JSON.stringify({samples: batch}));
		},
	};
}

let defaultTracker: JourneyTracker | undefined;

/** The browser's shared tracker, created on first use; undefined during SSR. */
export function defaultJourneyTracker(): JourneyTracker | undefined {
	if (typeof window === "undefined") return undefined;
	defaultTracker ??= createJourneyTracker(browserEnvironment());
	return defaultTracker;
}

/** Starts timing journey `id` from `trigger`'s timeStamp (or navigation start). A no-op during SSR. */
export function startJourney(id: string, options: StartJourneyOptions): void {
	defaultJourneyTracker()?.startJourney(id, options);
}

/** Ends journey `id` at the paint after `anchorSelector` matches an element with data, and queues the sample. */
export function endJourneyWhenRendered(id: string, anchorSelector: AnchorSelector): Promise<JourneySample | null> {
	return defaultJourneyTracker()?.endJourneyWhenRendered(id, anchorSelector) ?? Promise.resolve(null);
}
