import {useCallback, useRef, type RefCallback} from "react";
import {attachShrinkwrap, restoreShrinkwrap} from "../lib/shrinkwrap";

/**
 * Upstream's `an()` (claude.ai/code shared-frame): a ref callback that keeps the element's inline `max-width`
 * hugging its widest line. Disabled, it only restores the element's own inline max-width. Upstream remembers fits
 * across remounts when the session view turns on the CDS `shrinkWrapMemory` flag; every local consumer is in the
 * session view, so memory is on (and, as upstream, ignored when `immediate`).
 */
export function useShrinkwrap({
	enabled = true,
	immediate = false,
}: {enabled?: boolean; immediate?: boolean} = {}): RefCallback<HTMLElement> {
	const dispose = useRef<(() => void) | null>(null);
	return useCallback(
		(el: HTMLElement | null) => {
			const previous = dispose.current;
			dispose.current = null;
			previous?.();
			if (el === null) return;
			if (!enabled) {
				restoreShrinkwrap(el);
				return;
			}
			dispose.current = attachShrinkwrap(el, {immediate, remember: true});
		},
		[enabled, immediate],
	);
}
