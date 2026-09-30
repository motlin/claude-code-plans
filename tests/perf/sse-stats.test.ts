import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {
	addClient,
	broadcastTyped,
	getSseStats,
	removeClient,
	resetSseStats,
	stopSseStatsLog,
} from "../../src/lib/sse-broadcast";

function fakeController(enqueue: (chunk: Uint8Array) => void = () => {}): ReadableStreamDefaultController {
	return {enqueue} as unknown as ReadableStreamDefaultController;
}

const added: ReadableStreamDefaultController[] = [];

function add(controller: ReadableStreamDefaultController): ReadableStreamDefaultController {
	added.push(controller);
	addClient(controller);
	return controller;
}

function frameBytes(type: string, data: Record<string, unknown>): number {
	return new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).byteLength;
}

beforeEach(() => {
	resetSseStats();
});

afterEach(() => {
	for (const controller of added.splice(0)) removeClient(controller);
	stopSseStatsLog();
	resetSseStats();
	vi.unstubAllEnvs();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("SSE stats", () => {
	it("counts events, payload bytes and delivered bytes per event type", () => {
		const received: number[] = [];
		add(fakeController((chunk) => received.push(chunk.byteLength)));
		add(fakeController((chunk) => received.push(chunk.byteLength)));

		broadcastTyped("session:lines-appended", {sessionId: "a", lines: ["x"]});
		broadcastTyped("session:lines-appended", {sessionId: "b", lines: ["yy"]});
		broadcastTyped("content-updated", {});

		const appendA = frameBytes("session:lines-appended", {sessionId: "a", lines: ["x"]});
		const appendB = frameBytes("session:lines-appended", {sessionId: "b", lines: ["yy"]});
		const content = frameBytes("content-updated", {});
		expect({stats: getSseStats(), received: received.length}).toStrictEqual({
			stats: {
				"session:lines-appended": {
					events: 2,
					payloadBytes: appendA + appendB,
					deliveredBytes: 2 * (appendA + appendB),
				},
				"content-updated": {events: 1, payloadBytes: content, deliveredBytes: 2 * content},
			},
			received: 6,
		});
	});

	it("drops a client whose enqueue throws and does not count it as delivered", () => {
		add(fakeController());
		const broken = add(
			fakeController(() => {
				throw new Error("closed");
			}),
		);
		const brokenEnqueue = vi.spyOn(broken, "enqueue");

		broadcastTyped("x", {n: 1});
		broadcastTyped("x", {n: 2});

		const one = frameBytes("x", {n: 1});
		const two = frameBytes("x", {n: 2});
		expect({stats: getSseStats(), brokenCalls: brokenEnqueue.mock.calls.length}).toStrictEqual({
			stats: {x: {events: 2, payloadBytes: one + two, deliveredBytes: one + two}},
			brokenCalls: 1,
		});
	});

	it("resetSseStats clears all counters", () => {
		add(fakeController());
		broadcastTyped("x", {});
		resetSseStats();
		expect(getSseStats()).toStrictEqual({});
	});

	it("logs a per-minute summary line when CCB_PERF_LOG=1", () => {
		vi.stubEnv("CCB_PERF_LOG", "1");
		vi.useFakeTimers();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		add(fakeController());

		broadcastTyped("x", {});
		vi.advanceTimersByTime(59_999);
		expect(log).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);

		const bytes = frameBytes("x", {});
		expect(log.mock.calls.map(([line]) => JSON.parse(String(line)))).toStrictEqual([
			{
				perf: "sse",
				windowMs: 60_000,
				clients: 1,
				types: {x: {events: 1, payloadBytes: bytes, deliveredBytes: bytes}},
			},
		]);

		// An idle window logs nothing; the next window reports only its own events.
		vi.advanceTimersByTime(60_000);
		broadcastTyped("x", {});
		broadcastTyped("x", {});
		vi.advanceTimersByTime(60_000);
		expect(log.mock.calls.map(([line]) => JSON.parse(String(line)).types)).toStrictEqual([
			{x: {events: 1, payloadBytes: bytes, deliveredBytes: bytes}},
			{x: {events: 2, payloadBytes: 2 * bytes, deliveredBytes: 2 * bytes}},
		]);
	});

	it("does not start the summary log when CCB_PERF_LOG is unset", () => {
		vi.stubEnv("CCB_PERF_LOG", "");
		vi.useFakeTimers();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		add(fakeController());

		broadcastTyped("x", {});
		vi.advanceTimersByTime(120_000);
		expect(log).not.toHaveBeenCalled();
	});
});
