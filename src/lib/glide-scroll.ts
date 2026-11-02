import {isEditableTarget} from "./shortcuts/match";

/** Upstream c1c1ec7b9 `kDe`: each frame closes this fraction of the distance left. */
const GLIDE_STEP = 0.25;
/** Upstream `R7(scroller, lastWrite, 40)`: a scrollTop further than this from the last write is someone else's scroll. */
const OWN_SCROLL_SLACK = 40;

const activeGlides = new WeakMap<Element, () => void>();

/**
 * Upstream `R7`: "own" while scrollTop is within `slack` of the last write, "clamp" when the
 * write went past the end and the browser clamped it, else "foreign".
 */
function scrollOwner(scroller: Element, lastWrite: number, slack: number): "own" | "clamp" | "foreign"
{
	const top = scroller.scrollTop;
	if (Math.abs(top - lastWrite) <= slack) return "own";
	const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
	return lastWrite > max && Math.abs(top - max) <= 1 ? "clamp" : "foreign";
}

/**
 * Upstream c1c1ec7b9 `ke` (with `t9` as its stop): glides `scroller` toward `target()`, re-read
 * every frame so the landing follows rows that resize mid-glide. Each frame moves a quarter of the
 * way (at least 1px) and lands once within 1px. A wheel, touch, pointer press or non-editing key,
 * another scroll moving scrollTop off the last write, a newer glide, or a null target stops it.
 */
export function glideScrollTo(scroller: HTMLElement, target: () => number | null): void
{
	activeGlides.get(scroller)?.();
	const controller = new AbortController();
	let frame = 0;
	const stop = () =>
	{
		if (activeGlides.get(scroller) === stop) activeGlides.delete(scroller);
		cancelAnimationFrame(frame);
		controller.abort();
	};
	activeGlides.set(scroller, stop);
	const listen =
	{
		passive: true,
		signal: controller.signal,
	};
	scroller.addEventListener("wheel", stop, listen);
	scroller.addEventListener("touchstart", stop, listen);
	scroller.addEventListener("pointerdown", stop, listen);
	scroller.ownerDocument.addEventListener(
		"keydown",
		(event) =>
		{
			if (!isEditableTarget(event.target)) stop();
		},
		{
			capture: true,
			signal: controller.signal,
		},
	);
	let lastWrite = scroller.scrollTop;
	const step = () =>
	{
		if (controller.signal.aborted) return;
		const current = scroller.scrollTop;
		if (scrollOwner(scroller, lastWrite, OWN_SCROLL_SLACK) === "foreign")
		{
			stop();
			return;
		}
		const goal = target();
		if (goal === null)
		{
			stop();
			return;
		}
		if (Math.abs(goal - current) < 1)
		{
			stop();
			scroller.scrollTop = goal;
			return;
		}
		const distance = goal - current;
		scroller.scrollTop = current + Math.sign(distance) * Math.max(1, Math.abs(distance) * GLIDE_STEP);
		lastWrite = scroller.scrollTop;
		frame = requestAnimationFrame(step);
	};
	frame = requestAnimationFrame(step);
}
