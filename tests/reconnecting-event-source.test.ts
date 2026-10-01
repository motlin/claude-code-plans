import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {openReconnectingEventSource, sseReconnectDelay} from "../src/lib/reconnecting-event-source";

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
		openReconnectingEventSource("/api/events", {
			attach: (es) => attached.push(es.url),
			onReconnected: () => reconnects++,
		});
		TestEventSource.instances[0]!.open();

		TestEventSource.instances[0]!.fail();
		vi.advanceTimersByTime(sseReconnectDelay(0) - 1);
		const beforeDelay = TestEventSource.instances.length;
		vi.advanceTimersByTime(1);
		TestEventSource.instances[1]!.fail();
		vi.advanceTimersByTime(sseReconnectDelay(1));
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
		openReconnectingEventSource("/api/events", {attach: () => {}, onReconnected: () => reconnects++});
		const es = TestEventSource.instances[0]!;
		es.open();

		es.drop();
		vi.advanceTimersByTime(60_000);
		es.open();

		expect({instances: TestEventSource.instances.length, reconnects}).toStrictEqual({instances: 1, reconnects: 1});
	});

	it("starts the backoff over once a stream opens", () => {
		openReconnectingEventSource("/api/events", {attach: () => {}, onReconnected: () => {}});
		TestEventSource.instances[0]!.fail();
		vi.advanceTimersByTime(sseReconnectDelay(0));
		TestEventSource.instances[1]!.fail();
		vi.advanceTimersByTime(sseReconnectDelay(1));
		TestEventSource.instances[2]!.open();

		TestEventSource.instances[2]!.fail();
		vi.advanceTimersByTime(sseReconnectDelay(0));

		expect(TestEventSource.instances.length).toBe(4);
	});

	it("stops reconnecting once closed", () => {
		const close = openReconnectingEventSource("/api/events", {attach: () => {}, onReconnected: () => {}});
		TestEventSource.instances[0]!.fail();
		close();
		vi.advanceTimersByTime(60_000);

		expect(TestEventSource.instances.map((es) => es.closed)).toStrictEqual([true]);
	});
});

describe("sseReconnectDelay", () => {
	it("doubles from one second up to a thirty second ceiling", () => {
		expect([0, 1, 2, 3, 4, 5, 6].map(sseReconnectDelay)).toStrictEqual([
			1000, 2000, 4000, 8000, 16_000, 30_000, 30_000,
		]);
	});
});
