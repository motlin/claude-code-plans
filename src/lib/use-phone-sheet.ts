import { useSyncExternalStore } from "react";

/** claude.ai/code turns the sidebar into a full-screen sheet below 40rem (640px). */
export const PHONE_SHEET_QUERY = "(width < 40rem)";

function mediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(PHONE_SHEET_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const list = mediaQuery();
  if (!list) return () => undefined;
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return mediaQuery()?.matches ?? false;
}

/** True while the viewport is phone-sized and the sidebar should render as a sheet. */
export function usePhoneSheet(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
