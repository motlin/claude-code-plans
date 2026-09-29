import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

import { useSubscribeSessionRemovals } from "./use-claude-events";
import { stripAttentionCount } from "../lib/attention";
import {
  loadRecents,
  push,
  remove,
  retitle,
  routeToRecent,
  saveRecents,
  type RecentEntry,
} from "../lib/recents-history";
import { resolvedRouteTitle } from "../lib/route-title";

type AppRouter = ReturnType<typeof useRouter>;

const NOT_FOUND_TITLE = / Not Found$/;

function update(change: (entries: RecentEntry[]) => RecentEntry[]): void {
  saveRecents(change(loadRecents()));
}

/**
 * A page that 404s is not a place to switch back to: a loader that threw `notFound()` or errored,
 * or a route whose head reports the missing record ("Session Not Found").
 */
function resolvedToNotFound(router: AppRouter, title: string | null): boolean {
  const { matches, statusCode } = router.state;
  if (statusCode === 404) return true;
  if (matches.some((match) => match.status === "notFound" || match.status === "error")) {
    return true;
  }
  return title !== null && NOT_FOUND_TITLE.test(title);
}

function recordResolved(router: AppRouter): void {
  const target = routeToRecent(router.state.location.pathname);
  if (!target) return;
  const title = resolvedRouteTitle(router.state.matches);
  if (resolvedToNotFound(router, title)) {
    update((entries) => remove(entries, target.key));
    return;
  }
  update((entries) => push(entries, title === null ? target : { ...target, title }));
}

/**
 * Feeds the per-tab recents MRU behind the ⌃Q switcher. Every resolved navigation pushes its page;
 * the page being left is retitled from `document.title` so live title changes stick. Pages that
 * resolve to not-found, and sessions the index drops, are pruned.
 */
export function useRecentsRecorder(): void {
  const router = useRouter();
  const subscribeSessionRemovals = useSubscribeSessionRemovals();

  useEffect(() => {
    const unsubscribeBefore = router.subscribe("onBeforeNavigate", ({ fromLocation }) => {
      const left = fromLocation ? routeToRecent(fromLocation.pathname) : null;
      const title = stripAttentionCount(document.title);
      if (!left || title === "" || NOT_FOUND_TITLE.test(title)) return;
      update((entries) => retitle(entries, left.key, title));
    });
    const unsubscribeResolved = router.subscribe("onResolved", () => recordResolved(router));
    if (router.state.status === "idle" && router.state.matches.length > 0) recordResolved(router);
    return () => {
      unsubscribeBefore();
      unsubscribeResolved();
    };
  }, [router]);

  useEffect(
    () =>
      subscribeSessionRemovals((sessionId) => {
        update((entries) =>
          remove(remove(entries, `session:${sessionId}`), `subagents:${sessionId}`),
        );
      }),
    [subscribeSessionRemovals],
  );
}
