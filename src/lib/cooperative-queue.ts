const DEFAULT_SLICE_MS = 10;

interface QueuedJob {
	run: () => Promise<void>;
	promise: Promise<void>;
	resolve: () => void;
	reject: (error: unknown) => void;
}

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Runs keyed async jobs one at a time, handing the event loop back to timers, requests and SSE streams whenever a
 * slice has run for `sliceMs`. Firing a burst of jobs concurrently instead lets every finished read run its
 * synchronous database write back to back, stalling the loop for seconds. A key that is already waiting shares the
 * waiting job, so a job must read its input when it runs rather than when it is enqueued.
 */
export class CooperativeQueue {
	private readonly waiting = new Map<string, QueuedJob>();
	private draining = false;

	constructor(private readonly sliceMs = DEFAULT_SLICE_MS) {}

	enqueue(key: string, run: () => Promise<void>): Promise<void> {
		const existing = this.waiting.get(key);
		if (existing) return existing.promise;

		let resolve!: () => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<void>((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		});
		this.waiting.set(key, {run, promise, resolve, reject});
		if (!this.draining) void this.drain();
		return promise;
	}

	private async drain(): Promise<void> {
		this.draining = true;
		let sliceStart = performance.now();
		try {
			// A Map iterator also visits keys enqueued while it runs, so the loop ends only once the queue is empty.
			for (const [key, job] of this.waiting) {
				this.waiting.delete(key);
				try {
					await job.run();
					job.resolve();
				} catch (error) {
					job.reject(error);
				}
				if (performance.now() - sliceStart >= this.sliceMs) {
					await yieldToEventLoop();
					sliceStart = performance.now();
				}
			}
		} finally {
			this.draining = false;
		}
	}
}
