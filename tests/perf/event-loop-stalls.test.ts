import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {createRecursiveWatcher} from "../../src/lib/recursive-watch";
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

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

const INTERVAL_MS = 50;

/**
 * Drives the monitor's interval and clock by hand, so a test's stalls are exactly the ones it makes. On the real clock
 * a loaded machine descheduled the thread past the threshold on its own, adding a stall with no activity to the list.
 */
function fakeEventLoop(): {block: (ms: number) => void; idle: (ms: number) => void} {
	vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]});
	let nowMs = 0;
	let cpuMs = 0;
	vi.spyOn(performance, "now").mockImplementation(() => nowMs);
	vi.spyOn(process, "threadCpuUsage").mockImplementation(() => ({user: cpuMs * 1000, system: 0}));
	return {
		/** Synchronous work on the CPU: time passes and the monitor's timer can't fire. */
		block: (ms) => {
			nowMs += ms;
			cpuMs += ms;
		},
		/** A free event loop: the monitor's timer fires on time once per interval. */
		idle: (ms) => {
			for (let elapsed = 0; elapsed < ms; elapsed += INTERVAL_MS) {
				nowMs += INTERVAL_MS;
				vi.advanceTimersByTime(INTERVAL_MS);
			}
		},
	};
}

describe("startStallMonitor", () => {
	const stops: (() => void)[] = [];

	afterEach(() => {
		for (const stop of stops.splice(0)) stop();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	function monitor(thresholdMs: number): EventLoopStall[] {
		const stalls: EventLoopStall[] = [];
		stops.push(startStallMonitor({thresholdMs, intervalMs: INTERVAL_MS, onStall: (stall) => stalls.push(stall)}));
		return stalls;
	}

	it("reports a stall longer than the threshold with the activity that was running", async () => {
		const loop = fakeEventLoop();
		const stalls = monitor(200);
		loop.idle(50);

		await trackActivity("GET /api/slow", async () => {
			await Promise.resolve();
			loop.block(400);
		});
		loop.idle(100);

		expect(stalls).toStrictEqual([{durationMs: 400, cpuMs: 400, activities: ["GET /api/slow"]}]);
	});

	it("leaves out activities that ended before the stalled window", async () => {
		const loop = fakeEventLoop();
		const stalls = monitor(200);
		await trackActivity("GET /api/early", () => undefined);
		loop.idle(150);

		await trackActivity("scan jsonl /a.jsonl", () => {
			loop.block(400);
		});
		loop.idle(100);

		expect(stalls).toStrictEqual([{durationMs: 400, cpuMs: 400, activities: ["scan jsonl /a.jsonl"]}]);
	});

	it("restores the outer activity when a nested one ends and clears both once they end", async () => {
		const loop = fakeEventLoop();
		const stalls = monitor(200);
		loop.idle(50);

		await trackActivity("index /a.jsonl", async () => {
			await trackActivity("jsonl append /a.jsonl", async () => Promise.resolve());
			loop.idle(100);
			loop.block(400);
		});
		loop.idle(100);
		trackActivitySync("GET /api/sessions/recent", () => {
			loop.block(400);
		});
		loop.idle(100);

		expect(stalls).toStrictEqual([
			{durationMs: 400, cpuMs: 400, activities: ["index /a.jsonl"]},
			{durationMs: 400, cpuMs: 400, activities: ["GET /api/sessions/recent"]},
		]);
	});

	it("does not attribute a stall after startup to a watcher-ready wait whose watcher closed first", async () => {
		const root = await mkdtemp(join(tmpdir(), "stall-watcher-"));
		try {
			const watcher = createRecursiveWatcher([root], () => false);
			const waited = trackActivity("startup watcher ready", async () => watcher.whenReady());
			await watcher.close();
			const settled = await Promise.race([waited.then(() => "settled"), sleep(2000).then(() => "pending")]);

			const loop = fakeEventLoop();
			const stalls = monitor(200);
			loop.idle(50);
			trackActivitySync("GET /api/sessions/recent", () => {
				loop.block(400);
			});
			loop.idle(100);

			expect({settled, stalls}).toStrictEqual({
				settled: "settled",
				stalls: [{durationMs: 400, cpuMs: 400, activities: ["GET /api/sessions/recent"]}],
			});
		} finally {
			await rm(root, {recursive: true, force: true});
		}
	});

	// Retried: a loaded machine can deschedule the thread for longer than the threshold during the 50ms block,
	// which is a real stall the monitor must report (load average 100+ produced a 206ms one with 13ms of CPU).
	it("ignores delays under the threshold", {retry: 2}, async () => {
		const stalls = monitor(200);
		await sleep(60);

		blockFor(50);
		await sleep(120);

		expect(stalls).toStrictEqual([]);
	});

	it("measures how much of a stall the thread spent on the CPU", async () => {
		const stalls = monitor(200);
		await sleep(60);

		trackActivitySync("on-cpu", () => {
			burnCpu(400);
		});
		await sleep(120);
		trackActivitySync("off-cpu", () => {
			waitOffCpu(400);
		});
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
	it("returns the result and names a stall inside a synchronous phase", () => {
		const loop = fakeEventLoop();
		const stalls: EventLoopStall[] = [];
		const stop = startStallMonitor({
			thresholdMs: 200,
			intervalMs: INTERVAL_MS,
			onStall: (stall) => stalls.push(stall),
		});
		try {
			loop.idle(50);

			const value = trackActivitySync("session diff -repo", () => {
				loop.block(400);
				return 7;
			});
			loop.idle(100);

			expect({value, stalls}).toStrictEqual({
				value: 7,
				stalls: [{durationMs: 400, cpuMs: 400, activities: ["session diff -repo"]}],
			});
		} finally {
			stop();
			vi.restoreAllMocks();
			vi.useRealTimers();
		}
	});
});

describe("withActivityTracking", () => {
	it("names a request stall by method and path", async () => {
		vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]});
		const now = vi.spyOn(performance, "now").mockReturnValue(0);
		const cpu = vi.spyOn(process, "threadCpuUsage").mockReturnValue({user: 0, system: 0});
		const stalls: EventLoopStall[] = [];
		const stop = startStallMonitor({thresholdMs: 200, intervalMs: 50, onStall: (stall) => stalls.push(stall)});
		try {
			const handler = withActivityTracking(async () => {
				await Promise.resolve();
				// One blocked interval, independent of how often the OS deschedules this test.
				now.mockReturnValue(400);
				cpu.mockReturnValue({user: 400_000, system: 0});
				return new Response("ok");
			});
			const response = await handler(new Request("https://example.com/api/sessions/abc?tail=1"));
			vi.advanceTimersByTime(50);

			expect({body: await response.text(), stalls}).toStrictEqual({
				body: "ok",
				stalls: [{durationMs: 350, cpuMs: 400, activities: ["GET /api/sessions/abc"]}],
			});
		} finally {
			stop();
			vi.restoreAllMocks();
			vi.useRealTimers();
		}
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
