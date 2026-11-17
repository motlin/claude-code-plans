import {act} from "@testing-library/react";

/**
 * Replaces window's animation frames with a queue the test flushes by hand, so frame-driven code (the approval paint
 * sentinel) advances in step with the test. Call `restore()` after `vi.useRealTimers()`: fake timers installed over
 * the queue put it back when they uninstall, which a spy's restore can't undo.
 */
export function queueFrames()
{
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	const request = window.requestAnimationFrame;
	const cancel = window.cancelAnimationFrame;
	window.requestAnimationFrame = (callback) =>
	{
		nextFrame += 1;
		frames.set(nextFrame, callback);
		return nextFrame;
	};
	window.cancelAnimationFrame = (id) =>
	{
		frames.delete(id);
	};
	/** Runs the frames queued so far, `count` times over, each batch inside act. */
	const flush = (count = 1) =>
	{
		for (let index = 0; index < count; index++)
		{
			const due = [...frames.values()];
			frames.clear();
			act(() =>
			{
				for (const callback of due) callback(performance.now());
			});
		}
	};
	return {
		frames,
		flush,
		/** Upstream's paint sentinel needs two visible frames. */
		paint: () =>
		{
			flush(2);
		},
		restore: () =>
		{
			frames.clear();
			window.requestAnimationFrame = request;
			window.cancelAnimationFrame = cancel;
		},
	};
}
