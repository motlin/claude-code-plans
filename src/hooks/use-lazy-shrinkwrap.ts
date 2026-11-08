import {useCallback, useRef, type RefCallback} from "react";
import {loadedShrinkwrapEngine, loadShrinkwrapEngine, type ShrinkwrapEngine} from "../lib/shrinkwrap-loader";

/**
 * Upstream's `an()` (claude.ai/code shared-frame): a ref callback that keeps the element's inline `max-width`
 * hugging its widest line. Disabled, it only restores the element's own inline max-width. Upstream remembers fits
 * across remounts when the session view turns on the CDS `shrinkWrapMemory` flag; every local consumer is in the
 * session view, so memory is on (and, as upstream, ignored when `immediate`).
 *
 * The engine loads lazily (src/lib/shrinkwrap-loader.ts): once it is in hand the fit runs synchronously on attach;
 * before that, the element fits as soon as the download lands, if it is still attached.
 */
export function useLazyShrinkwrap({
	enabled = true,
	immediate = false,
}: {enabled?: boolean; immediate?: boolean} = {}): RefCallback<HTMLElement> {
	const dispose = useRef<(() => void) | null>(null);
	/** Bumped on every ref call, so a download that lands after a detach or re-attach fits nothing. */
	const attachment = useRef(0);
	return useCallback(
		(el: HTMLElement | null) => {
			const previous = dispose.current;
			dispose.current = null;
			previous?.();
			const current = ++attachment.current;
			if (el === null) return;
			const fit = (engine: ShrinkwrapEngine) => {
				if (!enabled) {
					engine.restoreShrinkwrap(el);
					return;
				}
				dispose.current = engine.attachShrinkwrap(el, {immediate, remember: true});
			};
			const engine = loadedShrinkwrapEngine();
			if (engine !== undefined) {
				fit(engine);
				return;
			}
			// Nothing was fitted without the engine, so a disabled element has no width to restore.
			if (!enabled) return;
			loadShrinkwrapEngine().then(
				(loaded) => {
					if (attachment.current === current) fit(loaded);
				},
				() => {
					// Unfitted is the element's own layout; the next attach retries the download.
				},
			);
		},
		[enabled, immediate],
	);
}
