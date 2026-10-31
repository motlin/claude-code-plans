/**
 * Time-slicing for long synchronous work on the server's single event loop.
 *
 * A stepped computation (a generator that `yield`s at safe pause points) runs
 * synchronously until `sliceMs` has elapsed, then waits one `setImmediate` turn
 * so queued I/O callbacks -- other requests -- are served before it resumes.
 */

/** How long a slice may hold the event loop before handing it back. */
export const DEFAULT_SLICE_MS = 8;

export interface Slicer {
	/** True once the current slice has used up its time. */
	due(): boolean;
	/** Wait one event-loop turn, then start a new slice. */
	pause(): Promise<void>;
}

export function createSlicer(sliceMs = DEFAULT_SLICE_MS): Slicer {
	let sliceStart = performance.now();
	return {
		due: () => performance.now() - sliceStart >= sliceMs,
		async pause() {
			await new Promise<void>((resolve) => {
				setImmediate(resolve);
			});
			sliceStart = performance.now();
		},
	};
}

/** Drive `steps` to completion, handing the event loop back whenever a slice runs out. */
export async function runCooperatively<T>(steps: Generator<void, T, void>, slicer: Slicer): Promise<T> {
	for (;;) {
		const step = steps.next();
		if (step.done) return step.value;
		if (slicer.due()) await slicer.pause();
	}
}
