import {type RefObject, useEffect, useState} from "react";

/** Upstream's `ut`: one band sweep, matching the `cds-shimmer-text-band` animation in globals.css. */
export const SHIMMER_PERIOD_MS = 3000;

/** Upstream's `eE`: a negative delay that puts a freshly mounted shimmer in phase with the rest. */
export function shimmerPhaseDelay(): number {
	return -(performance.now() % SHIMMER_PERIOD_MS);
}

function loopsForever(animation: Animation): boolean {
	return animation.effect?.getComputedTiming().iterations === Infinity;
}

/**
 * Upstream `Cz`: a phase delay that starts as `shimmerPhaseDelay()`, then, once the infinite
 * band animation under `ref` is ready, locks to its document-timeline `startTime` exactly.
 */
export function useTimelineShimmerDelay(ref: RefObject<Element | null>): number {
	const [delay, setDelay] = useState(shimmerPhaseDelay);
	useEffect(() => {
		let live = true;
		const sync = () => {
			const element = ref.current;
			if (!element || typeof element.getAnimations !== "function") return;
			const animation = element.getAnimations({subtree: true}).find(loopsForever);
			if (!animation) return;
			animation.ready.then(
				() => {
					if (live && typeof animation.startTime === "number")
						setDelay(-(animation.startTime % SHIMMER_PERIOD_MS));
				},
				() => {
					if (live) sync();
				},
			);
		};
		sync();
		return () => {
			live = false;
		};
	}, [ref]);
	return delay;
}
