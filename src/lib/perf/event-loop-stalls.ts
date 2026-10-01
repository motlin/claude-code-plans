// In dev, nitro forwards every request to one worker thread. While that thread's event loop is blocked it cannot
// accept connections, so the proxy fails with "connect ETIMEDOUT". This monitor names what was running when the
// loop stalled: requests, scan steps and the other long server phases register themselves with trackActivity or
// trackActivitySync. Each stall also reports how much CPU the thread used meanwhile: a stall with little CPU was not
// this thread's code running but the thread waiting (a blocking syscall, a SQLite lock, or a busy machine).

export interface EventLoopStall {
	/** How much later than scheduled the monitor's timer fired, in milliseconds: a lower bound on the stall. */
	durationMs: number;
	/** CPU time this thread used over the window, in milliseconds, including garbage collection on the thread. */
	cpuMs: number;
	/** Labels of the activities that were running at any point in the window, oldest first. */
	activities: string[];
}

interface Activity {
	label: string;
	startedAt: number;
	endedAt?: number;
}

const inFlight = new Set<Activity>();
let recentlyEnded: Activity[] = [];
let runningMonitors = 0;

/** Runs `fn` as a named activity, so a stall monitor can report it if the event loop stalls meanwhile. */
export async function trackActivity<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
	const activity: Activity = {label, startedAt: performance.now()};
	inFlight.add(activity);
	try {
		return await fn();
	} finally {
		inFlight.delete(activity);
		activity.endedAt = performance.now();
		// Ended activities are only kept while a monitor can still attribute a stall to them.
		if (runningMonitors > 0) recentlyEnded.push(activity);
	}
}

/** Runs synchronous `fn` as a named activity, so a stall monitor can report it if `fn` blocks the event loop. */
export function trackActivitySync<T>(label: string, fn: () => T): T {
	const activity: Activity = {label, startedAt: performance.now()};
	inFlight.add(activity);
	try {
		return fn();
	} finally {
		inFlight.delete(activity);
		activity.endedAt = performance.now();
		if (runningMonitors > 0) recentlyEnded.push(activity);
	}
}

function threadCpuMs(): number {
	const {user, system} = process.threadCpuUsage();
	return (user + system) / 1000;
}

function activitiesSince(windowStart: number): string[] {
	const overlapping = [...recentlyEnded.filter((activity) => activity.endedAt! >= windowStart), ...inFlight];
	overlapping.sort((a, b) => a.startedAt - b.startedAt);
	return [...new Set(overlapping.map((activity) => activity.label))];
}

export interface StallMonitorOptions {
	/** Report any single event-loop delay longer than this. */
	thresholdMs: number;
	onStall: (stall: EventLoopStall) => void;
	/** How often the monitor's timer ticks; each tick reports on the window since the previous one. */
	intervalMs?: number;
}

/**
 * Starts watching the event loop. A timer that fires late was held up by whatever ran in between, so the lateness
 * is measured on the monitor's own timer rather than with perf_hooks' monitorEventLoopDelay, whose histogram can
 * record a stall only after this timer has already read it, attributing it to the wrong window.
 * Returns a function that stops the monitor.
 */
export function startStallMonitor({thresholdMs, onStall, intervalMs = 100}: StallMonitorOptions): () => void {
	runningMonitors += 1;
	let windowStart = performance.now();
	let windowStartCpuMs = threadCpuMs();

	const timer = setInterval(() => {
		const now = performance.now();
		const nowCpuMs = threadCpuMs();
		const durationMs = now - windowStart - intervalMs;
		if (durationMs > thresholdMs) {
			onStall({durationMs, cpuMs: nowCpuMs - windowStartCpuMs, activities: activitiesSince(windowStart)});
		}
		windowStart = now;
		windowStartCpuMs = nowCpuMs;
		recentlyEnded = recentlyEnded.filter((activity) => activity.endedAt! >= windowStart);
	}, intervalMs);
	timer.unref();

	let stopped = false;
	return () => {
		if (stopped) return;
		stopped = true;
		clearInterval(timer);
		runningMonitors -= 1;
		if (runningMonitors === 0) recentlyEnded = [];
	};
}

export function formatStall(stall: EventLoopStall): string {
	const during = stall.activities.length > 0 ? stall.activities.join(", ") : "no tracked activity";
	const offCpu = stall.cpuMs < stall.durationMs / 2 ? ", off-CPU: blocking syscall, lock wait or busy machine" : "";
	return `[event-loop] blocked for ${Math.round(stall.durationMs)} ms (cpu ${Math.round(stall.cpuMs)} ms${offCpu}) during: ${during}`;
}

/** Wraps a fetch handler so each request is a tracked activity named by its method and path. */
export function withActivityTracking(
	handler: (request: Request) => Response | Promise<Response>,
): (request: Request) => Promise<Response> {
	return (request) => trackActivity(`${request.method} ${new URL(request.url).pathname}`, () => handler(request));
}
