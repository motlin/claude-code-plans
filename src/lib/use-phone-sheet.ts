import { useSyncExternalStore } from "react";

/** claude.ai/code turns the sidebar into a full-screen sheet below 40rem (640px). */
export const PHONE_SHEET_QUERY = "(width < 40rem)";

/** Below 48rem (768px) claude.ai/code forces the sidebar collapsed whatever the stored pref. */
export const NARROW_VIEWPORT_QUERY = "(width < 48rem)";

function mediaQuery(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(query);
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = mediaQuery(query);
      if (!list) return () => undefined;
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => mediaQuery(query)?.matches ?? false,
    () => false,
  );
}

/** True while the viewport is phone-sized and the sidebar should render as a sheet. */
export function usePhoneSheet(): boolean {
  return useMediaQuery(PHONE_SHEET_QUERY);
}

/** True below 768px, where the sidebar renders collapsed with hover peek (upstream `isNarrowViewport`). */
export function useNarrowViewport(): boolean {
  return useMediaQuery(NARROW_VIEWPORT_QUERY);
}
