import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {
	openReconnectingEventSource,
	type ReconnectingEventSourceOptions,
	sseReconnectDelay,
	type StreamStatus,
} from "../src/lib/reconnecting-event-source";

/** Pins the backoff jitter to its midpoint, so each delay is exactly the doubling base. */
const noJitter = (): number => 0.5;

function open(options: Partial<ReconnectingEventSourceOptions> = {}): () => void {
	return openReconnectingEventSource("/api/events", {
		attach: () => {},
		onReconnected: () => {},
		random: noJitter,
		...options,
	});
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

class TestEventSource extends EventTarget {
	static instances: TestEventSource[] = [];

	readyState = CONNECTING;
	closed = false;
	onerror: ((event: Event) => void) | null = null;

	constructor(readonly url: string) {
		super();
		TestEventSource.instances.push(this);
	}

	close(): void {
		this.closed = true;
		this.readyState = CLOSED;
	}

	open(): void {
		this.readyState = OPEN;
		this.dispatchEvent(new Event("open"));
	}

	/** A non-200 response, such as a 503 while the dev server restarts: the browser gives up on the stream. */
	fail(): void {
		this.readyState = CLOSED;
		this.onerror?.(new Event("error"));
	}

	/** A dropped connection: the browser reconnects by itself. */
	drop(): void {
		this.readyState = CONNECTING;
		this.onerror?.(new Event("error"));
	}
}

describe("openReconnectingEventSource", () => {
	beforeEach(() => {
		TestEventSource.instances = [];
		vi.stubGlobal("EventSource", TestEventSource);
		vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("opens a new stream with backoff after a 503 closes it, then catches up once it reconnects", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const attached: string[] = [];
		let reconnects = 0;
		open({attach: (es) => attached.push(es.url), onReconnected: () => reconnects++});
		TestEventSource.instances[0]!.open();

		TestEventSource.instances[0]!.fail();
		vi.advanceTimersByTime(sseReconnectDelay(0, noJitter) - 1);
		const beforeDelay = TestEventSource.instances.length;
		vi.advanceTimersByTime(1);
		TestEventSource.instances[1]!.fail();
		vi.advanceTimersByTime(sseReconnectDelay(1, noJitter));
		TestEventSource.instances[2]!.open();

		expect({
			beforeDelay,
			attached,
			closed: TestEventSource.instances.map((es) => es.closed),
			reconnects,
			logged: error.mock.calls,
		}).toStrictEqual({
			beforeDelay: 1,
			attached: ["/api/events", "/api/events", "/api/events"],
			closed: [true, true, false],
			reconnects: 1,
			logged: [],
		});
	});

	it("leaves a dropped connection to the browser's own reconnect, and still catches up when it reopens", () => {
		let reconnects = 0;
		open({onReconnected: () => reconnects++});
		const es = TestEventSource.instances[0]!;
		es.open();

		es.drop();
		vi.advanceTimersByTime(60_000);
		es.open();

		expect({instances: TestEventSource.instances.length, reconnects}).toStrictEqual({instances: 1, reconnects: 1});
	});

	it("starts the backoff over once a stream opens", () => {
		open();
		TestEventSource.instances[0]!.fail();
		vi.advanceTimersByTime(sseReconnectDelay(0, noJitter));
		TestEventSource.instances[1]!.fail();
		vi.advanceTimersByTime(sseReconnectDelay(1, noJitter));
		TestEventSource.instances[2]!.open();

		TestEventSource.instances[2]!.fail();
		vi.advanceTimersByTime(sseReconnectDelay(0, noJitter));

		expect(TestEventSource.instances.length).toBe(4);
	});

	it("catches up on the first open when told the stream starts after a gap, as a tab taking over the shared stream is", () => {
		let reconnects = 0;
		open({onReconnected: () => reconnects++, resumeAfterGap: true});
		const before = reconnects;
		TestEventSource.instances[0]!.open();

		expect({before, after: reconnects}).toStrictEqual({before: 0, after: 1});
	});

	it("reports connecting then connected as the first stream opens", () => {
		const statuses: StreamStatus[] = [];
		open({onStatus: (status) => statuses.push(status)});
		const beforeOpen = [...statuses];
		TestEventSource.instances[0]!.open();

		expect({beforeOpen, statuses}).toStrictEqual({
			beforeOpen: ["connecting"],
			statuses: ["connecting", "connected"],
		});
	});

	it("reports reconnecting when a 503 closes the stream, then connecting as the next stream opens after the delay", () => {
		const statuses: StreamStatus[] = [];
		open({onStatus: (status) => statuses.push(status)});
		TestEventSource.instances[0]!.open();
		statuses.length = 0;

		TestEventSource.instances[0]!.fail();
		const afterFail = [...statuses];
		vi.advanceTimersByTime(sseReconnectDelay(0, noJitter));
		const afterDelay = [...statuses];
		TestEventSource.instances[1]!.open();

		expect({afterFail, afterDelay, statuses}).toStrictEqual({
			afterFail: ["reconnecting"],
			afterDelay: ["reconnecting", "connecting"],
			statuses: ["reconnecting", "connecting", "connected"],
		});
	});

	it("reports reconnecting while the browser retries a dropped connection, and connected once it reopens", () => {
		const statuses: StreamStatus[] = [];
		open({onStatus: (status) => statuses.push(status)});
		const es = TestEventSource.instances[0]!;
		es.open();
		statuses.length = 0;

		es.drop();
		es.drop();
		const afterDrops = [...statuses];
		es.open();

		expect({afterDrops, statuses}).toStrictEqual({
			afterDrops: ["reconnecting"],
			statuses: ["reconnecting", "connected"],
		});
	});

	it("jitters each reopen delay by the injected random", () => {
		open({random: () => 0});
		TestEventSource.instances[0]!.fail();
		vi.advanceTimersByTime(749);
		const before = TestEventSource.instances.length;
		vi.advanceTimersByTime(1);

		expect({before, after: TestEventSource.instances.length}).toStrictEqual({before: 1, after: 2});
	});

	it("stops reconnecting once closed", () => {
		const close = open();
		TestEventSource.instances[0]!.fail();
		close();
		vi.advanceTimersByTime(60_000);

		expect(TestEventSource.instances.map((es) => es.closed)).toStrictEqual([true]);
	});
});

describe("sseReconnectDelay", () => {
	it("doubles from one second up to a thirty second ceiling", () => {
		expect([0, 1, 2, 3, 4, 5, 6].map((attempt) => sseReconnectDelay(attempt, noJitter))).toStrictEqual([
			1000, 2000, 4000, 8000, 16_000, 30_000, 30_000,
		]);
	});

	it("jitters the delay between three quarters and five quarters of the base", () => {
		expect({
			low: sseReconnectDelay(0, () => 0),
			high: sseReconnectDelay(0, () => 1),
			ceiling: sseReconnectDelay(10, () => 0.5),
		}).toStrictEqual({low: 750, high: 1250, ceiling: 30_000});
	});
});
