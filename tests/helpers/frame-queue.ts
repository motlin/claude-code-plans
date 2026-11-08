import {vi} from "vite-plus/test";

/**
 * A manual animation-frame queue with a controllable clock: `requestAnimationFrame` queues callbacks that run only
 * when the test calls `frame(ts)`, and `performance.now()` returns `now`.
 */
export interface FrameQueue {
	/** Pending frame ids, in request order. */
	readonly pending: () => number[];
	/** Sets the clock `performance.now()` reads. */
	readonly setNow: (ms: number) => void;
	/** Runs every queued callback with `ts` (also moving the clock there); callbacks they queue wait for the next call. */
	readonly frame: (ts: number) => void;
	readonly cancelAnimationFrame: ReturnType<typeof vi.fn>;
}

export function installFrameQueue(): FrameQueue {
	let now = 0;
	let nextId = 1;
	const queue = new Map<number, FrameRequestCallback>();
	vi.spyOn(performance, "now").mockImplementation(() => now);
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		const id = nextId;
		nextId += 1;
		queue.set(id, callback);
		return id;
	});
	const cancel = vi.fn<(id: number) => void>((id) => {
		queue.delete(id);
	});
	vi.stubGlobal("cancelAnimationFrame", cancel);
	return {
		pending: () => [...queue.keys()],
		setNow: (ms) => {
			now = ms;
		},
		frame: (ts) => {
			now = ts;
			const due = [...queue.entries()];
			queue.clear();
			for (const [, callback] of due) callback(ts);
		},
		cancelAnimationFrame: cancel,
	};
}

/** Stubs `window.matchMedia` so `(prefers-reduced-motion: reduce)` matches when `reduced`. */
export function stubReducedMotion(reduced: boolean): void {
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: reduced && query === "(prefers-reduced-motion: reduce)",
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
}
