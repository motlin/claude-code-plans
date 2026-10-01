import {afterEach, describe, expect, it} from "vite-plus/test";
import {
	formatStall,
	startStallMonitor,
	trackActivity,
	trackActivitySync,
	withActivityTracking,
	type EventLoopStall,
} from "../../src/lib/perf/event-loop-stalls";

function blockFor(ms: number): void {
	const until = performance.now() + ms;
	while (performance.now() < until) {
		// spin: a synchronous section the monitor must notice
	}
}

function threadCpuMs(): number {
	const {user, system} = process.threadCpuUsage();
	return (user + system) / 1000;
}

/** Spins until the thread has spent `ms` on the CPU, however long a busy machine takes to grant it. */
function burnCpu(ms: number): void {
	const until = threadCpuMs() + ms;
	while (threadCpuMs() < until) {
		// spin: CPU time, not wall time, so a descheduled thread still burns the full amount
	}
}

/** Blocks the thread without using CPU, as a synchronous syscall, a lock wait or a descheduled thread does. */
function waitOffCpu(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

	it("measures how much of a stall the thread spent on the CPU", async () => {
		const stalls = monitor(200);
		await sleep(60);

		trackActivitySync("on-cpu", () => burnCpu(400));
		await sleep(120);
		trackActivitySync("off-cpu", () => waitOffCpu(400));
		await sleep(120);

		// Select by activity: a loaded machine can add stalls of its own, and it stretches wall
		// time but never adds CPU time to a thread that is waiting.
		const named = (activity: string) => stalls.find((stall) => stall.activities.includes(activity));
		const onCpu = named("on-cpu");
		const offCpu = named("off-cpu");
		expect({
			onCpu: onCpu !== undefined && onCpu.cpuMs >= 350,
			offCpu: offCpu !== undefined && offCpu.cpuMs < offCpu.durationMs / 4,
		}).toStrictEqual({onCpu: true, offCpu: true});
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

describe("trackActivitySync", () => {
	it("returns the result and names a stall inside a synchronous phase", async () => {
		const stalls: EventLoopStall[] = [];
		const stop = startStallMonitor({thresholdMs: 200, intervalMs: 50, onStall: (stall) => stalls.push(stall)});
		await sleep(60);

		const value = trackActivitySync("session diff -repo", () => {
			blockFor(400);
			return 7;
		});
		await sleep(120);
		stop();

		expect({value, activities: stalls.map((stall) => stall.activities)}).toStrictEqual({
			value: 7,
			activities: [["session diff -repo"]],
		});
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
	it("names the duration, the thread's CPU time and the activities", () => {
		expect([
			formatStall({
				durationMs: 1234.4,
				cpuMs: 1201.2,
				activities: ["GET /api/sessions/abc", "scan jsonl /a.jsonl"],
			}),
			formatStall({durationMs: 600, cpuMs: 580, activities: []}),
		]).toStrictEqual([
			"[event-loop] blocked for 1234 ms (cpu 1201 ms) during: GET /api/sessions/abc, scan jsonl /a.jsonl",
			"[event-loop] blocked for 600 ms (cpu 580 ms) during: no tracked activity",
		]);
	});

	it("flags a stall the thread spent mostly off the CPU", () => {
		expect(formatStall({durationMs: 20405, cpuMs: 312, activities: []})).toBe(
			"[event-loop] blocked for 20405 ms (cpu 312 ms, off-CPU: blocking syscall, lock wait or busy machine) during: no tracked activity",
		);
	});
});
