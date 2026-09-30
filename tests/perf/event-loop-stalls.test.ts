import {afterEach, describe, expect, it} from "vite-plus/test";
import {
	formatStall,
	startStallMonitor,
	trackActivity,
	withActivityTracking,
	type EventLoopStall,
} from "../../src/lib/perf/event-loop-stalls";

function blockFor(ms: number): void {
	const until = performance.now() + ms;
	while (performance.now() < until) {
		// spin: a synchronous section the monitor must notice
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("startStallMonitor", () => {
	const stops: (() => void)[] = [];

	afterEach(() => {
		for (const stop of stops.splice(0)) stop();
	});

	function monitor(thresholdMs: number): EventLoopStall[] {
		const stalls: EventLoopStall[] = [];
		stops.push(startStallMonitor({thresholdMs, intervalMs: 50, onStall: (stall) => stalls.push(stall)}));
		return stalls;
	}

	it("reports a stall longer than the threshold with the activity that was running", async () => {
		const stalls = monitor(200);
		await sleep(60);

		await trackActivity("GET /api/slow", async () => {
			await sleep(10);
			blockFor(400);
		});
		await sleep(120);

		expect(
			stalls.map((stall) => ({longEnough: stall.durationMs >= 350, activities: stall.activities})),
		).toStrictEqual([{longEnough: true, activities: ["GET /api/slow"]}]);
	});

	it("leaves out activities that ended before the stalled window", async () => {
		const stalls = monitor(200);
		await trackActivity("GET /api/early", () => undefined);
		await sleep(150);

		await trackActivity("scan jsonl /a.jsonl", () => blockFor(400));
		await sleep(120);

		expect(stalls.map((stall) => stall.activities)).toStrictEqual([["scan jsonl /a.jsonl"]]);
	});

	it("ignores delays under the threshold", async () => {
		const stalls = monitor(200);
		await sleep(60);

		blockFor(50);
		await sleep(120);

		expect(stalls).toStrictEqual([]);
	});

	it("stops reporting once stopped", async () => {
		const stalls: EventLoopStall[] = [];
		const stop = startStallMonitor({thresholdMs: 100, intervalMs: 50, onStall: (stall) => stalls.push(stall)});
		stop();
		stop();

		blockFor(250);
		await sleep(120);

		expect(stalls).toStrictEqual([]);
	});
});

describe("trackActivity", () => {
	it("returns the activity's result and rethrows its error", async () => {
		const value = await trackActivity("ok", () => 42);
		const error = await trackActivity("fails", () => {
			throw new Error("boom");
		}).catch((err: unknown) => err);

		expect({value, message: (error as Error).message}).toStrictEqual({value: 42, message: "boom"});
	});
});

describe("withActivityTracking", () => {
	it("names a request stall by method and path", async () => {
		const stalls: EventLoopStall[] = [];
		const stop = startStallMonitor({thresholdMs: 200, intervalMs: 50, onStall: (stall) => stalls.push(stall)});
		await sleep(60);

		const handler = withActivityTracking(async () => {
			await sleep(10);
			blockFor(400);
			return new Response("ok");
		});
		const response = await handler(new Request("http://localhost/api/sessions/abc?tail=1"));
		await sleep(120);
		stop();

		expect({body: await response.text(), activities: stalls.map((stall) => stall.activities)}).toStrictEqual({
			body: "ok",
			activities: [["GET /api/sessions/abc"]],
		});
	});
});

describe("formatStall", () => {
	it("names the duration and the activities", () => {
		expect([
			formatStall({durationMs: 1234.4, activities: ["GET /api/sessions/abc", "scan jsonl /a.jsonl"]}),
			formatStall({durationMs: 600, activities: []}),
		]).toStrictEqual([
			"[event-loop] blocked for 1234 ms during: GET /api/sessions/abc, scan jsonl /a.jsonl",
			"[event-loop] blocked for 600 ms during: no tracked activity",
		]);
	});
});
