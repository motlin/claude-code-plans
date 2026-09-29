import { useSyncExternalStore } from "react";

/** Each matched min-height adds a row to the home action-center cap, like claude.ai/code. */
const ROW_LIMIT_QUERIES = [800, 900, 1000, 1100].map((height) => `(min-height: ${height}px)`);
const BASE_ROW_LIMIT = 3;

const supportsMatchMedia = () => typeof window.matchMedia === "function";

function subscribe(onChange: () => void): () => void {
  if (!supportsMatchMedia()) return () => undefined;
  const lists = ROW_LIMIT_QUERIES.map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

function getSnapshot(): number {
  if (!supportsMatchMedia()) return BASE_ROW_LIMIT;
  return ROW_LIMIT_QUERIES.reduce(
    (limit, query) => (window.matchMedia(query).matches ? limit + 1 : limit),
    BASE_ROW_LIMIT,
  );
}

/** Rows the home sections show before "Show N more": 3 below an 800px viewport, up to 7. */
export function useViewportRowLimit(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => BASE_ROW_LIMIT);
}
