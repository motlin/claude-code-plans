import {useSyncExternalStore} from "react";

/** claude.ai/code turns the sidebar into a full-screen sheet below 40rem (640px). */
export const PHONE_SHEET_QUERY = "(width < 40rem)";

/** claude.ai/code's Settings dialog switches to its phone layout (tab strip, no search) at ≤767px (`T`). */
export const SETTINGS_PHONE_QUERY = "(max-width: 767px)";

/**
 * claude.ai/code's narrow-viewport query (`JJ`/`$C`): the sidebar is forced collapsed whatever the
 * stored pref at ≤ max(700, ceil(sidebarWidth) + 329)px, so ≤700px at the default 288 and ≤749px at 420.
 */
export function narrowViewportQuery(sidebarWidth: number): string {
	return `(max-width: ${Math.max(700, Math.ceil(sidebarWidth) + 329)}px)`;
}

function mediaQuery(query: string): MediaQueryList | null {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
	return window.matchMedia(query);
}

/** Subscribe to a CSS media query; false during SSR and where matchMedia is unavailable. */
export function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const list = mediaQuery(query);
			if (!list) return () => undefined;
			list.addEventListener("change", onChange);
			return () => {
				list.removeEventListener("change", onChange);
			};
		},
		() => mediaQuery(query)?.matches ?? false,
		() => false,
	);
}

/** True while the viewport is phone-sized and the sidebar should render as a sheet. */
export function usePhoneSheet(): boolean {
	return useMediaQuery(PHONE_SHEET_QUERY);
}

/**
 * Upstream's density/split-send gate (shared-frame `DN`): exactly `(pointer: coarse)`.
 * Unlike `TOUCH_QUERY` in touch-reveal.ts, `(hover: none)` alone does not count.
 */
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

/**
 * True while the primary pointer is coarse. Mirrors upstream cds root `si`'s
 * `useSyncExternalStore(zE, $H, u4)`: live on pointer changes, false on the server.
 */
export function useCoarsePointer(): boolean {
	return useMediaQuery(COARSE_POINTER_QUERY);
}
