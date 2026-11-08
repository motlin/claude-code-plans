import {useEffect, useRef, useState} from "react";

import {usePrefersReducedMotion} from "../lib/reduced-motion";

/** Upstream `Xe`'s default duration. */
export const COUNT_TWEEN_MS = 400;

/** Upstream's `Ze`. */
export function easeOutCubic(t: number): number {
	return 1 - (1 - t) ** 3;
}

/**
 * Upstream's `Xe`: eases a live count to each new value over `durationMs` (easeOutCubic, whole numbers). The first
 * render shows the real value; a new target mid-tween restarts from the painted value. Copying upstream exactly, the
 * gate is the OS reduced-motion query alone (not `html[data-reduce-motion]`), and it snaps in the same render.
 */
export function useCountTween(value: number, durationMs = COUNT_TWEEN_MS): number {
	const reduced = usePrefersReducedMotion();
	const [shown, setShown] = useState(value);
	if (reduced && !Object.is(shown, value)) setShown(value);
	const lastRef = useRef(value);
	useEffect(() => {
		const from = lastRef.current;
		if (reduced || from === value) {
			lastRef.current = value;
			return undefined;
		}
		const start = performance.now();
		const delta = value - from;
		let frame = 0;
		const step = (ts: number) => {
			const p = Math.min(1, Math.max(0, (ts - start) / durationMs));
			const next = Math.round(from + delta * easeOutCubic(p));
			lastRef.current = next;
			setShown(next);
			if (p < 1) frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => {
			cancelAnimationFrame(frame);
		};
	}, [value, durationMs, reduced]);
	return shown;
}
