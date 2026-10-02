import {useEffect} from "react";
import {useRouter} from "@tanstack/react-router";
import {useQueryClient, type QueryClient} from "@tanstack/react-query";

import {useSubscribeSessionRemovals} from "./use-claude-events";
import {stripAttentionCount} from "../lib/attention";
import {
	loadRecents,
	push,
	remove,
	retitle,
	routeToRecent,
	resolveRecentSessions,
	saveRecents,
	type RecentEntry,
	type RecentTarget,
} from "../lib/recents-history";
import {getCachedSessionIdentity} from "../lib/api/session-identity";
import {sessionQueryKeys} from "../lib/api/sessions";
import {resolvedRouteTitle} from "../lib/route-title";

type AppRouter = ReturnType<typeof useRouter>;

const NOT_FOUND_TITLE = / Not Found$/;

function update(queryClient: QueryClient, change: (entries: RecentEntry[]) => RecentEntry[]): void {
	const entries = resolveRecentSessions(loadRecents(), (alias) => getCachedSessionIdentity(queryClient, alias));
	saveRecents(change(entries));
}

function resolvedTarget(queryClient: QueryClient, pathname: string): RecentTarget | null {
	const target = routeToRecent(pathname);
	if (!target) return null;
	const [resolved] = resolveRecentSessions([target], (alias) => getCachedSessionIdentity(queryClient, alias));
	if (!resolved) return null;
	if (
		(resolved.kind === "session" || resolved.kind === "subagents") &&
		resolved.key.slice(resolved.kind.length + 1).startsWith("session_")
	)
		return null;
	return resolved;
}

function locationKey(location: AppRouter["state"]["location"]): string {
	return location.state.__TSR_key ?? location.href;
}

/**
 * A page that 404s is not a place to switch back to: a loader that threw `notFound()` or errored,
 * or a route whose head reports the missing record ("Session Not Found").
 */
function resolvedToNotFound(router: AppRouter, title: string | null): boolean {
	const {matches, statusCode} = router.state;
	if (statusCode === 404) return true;
	if (matches.some((match) => match.status === "notFound" || match.status === "error")) {
		return true;
	}
	return title !== null && NOT_FOUND_TITLE.test(title);
}

/**
 * Feeds the per-tab recents MRU behind the ⌃Q switcher. Every resolved navigation pushes its page;
 * the page being left is retitled from `document.title` so live title changes stick. Pages that
 * resolve to not-found, and sessions the index drops, are pruned.
 */
export function useRecentsRecorder(): void {
	const router = useRouter();
	const queryClient = useQueryClient();
	const subscribeSessionRemovals = useSubscribeSessionRemovals();

	useEffect(() => {
		let visit: {key: string; pathname: string; target: RecentTarget | null} | null = null;
		let navigating = false;
		const recordResolved = () => {
			const location = router.state.location;
			if (!routeToRecent(location.pathname)) {
				visit = null;
				return;
			}
			const key = locationKey(location);
			if (visit?.key !== key || visit.pathname !== location.pathname) {
				visit = {key, pathname: location.pathname, target: null};
			}
			// Pin a visit's first local owner even if its alias later becomes ambiguous or changes owner.
			visit.target ??= resolvedTarget(queryClient, location.pathname);
			if (!visit.target) return;
			const target = resolveRecentSessions([visit.target], (alias) =>
				getCachedSessionIdentity(queryClient, alias),
			)[0]!;
			const title = resolvedRouteTitle(router.state.matches);
			if (resolvedToNotFound(router, title)) {
				update(queryClient, (entries) => remove(entries, target.key));
				return;
			}
			update(queryClient, (entries) => push(entries, title === null ? target : {...target, title}));
		};
		const unsubscribeBefore = router.subscribe("onBeforeNavigate", ({fromLocation}) => {
			navigating = true;
			const left = fromLocation
				? visit?.key === locationKey(fromLocation) && visit.pathname === fromLocation.pathname
					? visit.target
					: resolvedTarget(queryClient, fromLocation.pathname)
				: null;
			const title = stripAttentionCount(document.title);
			if (!left || title === "" || NOT_FOUND_TITLE.test(title)) return;
			update(queryClient, (entries) => retitle(entries, left.key, title));
		});
		const unsubscribeResolved = router.subscribe("onResolved", () => {
			navigating = false;
			recordResolved();
		});
		const [sessionRoot, identityRoot] = sessionQueryKeys.identities();
		const unsubscribeIdentity = queryClient.getQueryCache().subscribe((event) => {
			if (event.type !== "added" && event.type !== "updated" && event.type !== "removed") return;
			const key = event.query.queryKey;
			if (key[0] !== sessionRoot || key[1] !== identityRoot) return;
			// Background resolutions normalize old visits in place; only a still-current pending visit can move front.
			update(queryClient, (entries) => entries);
			const {location, resolvedLocation, status} = router.state;
			if (navigating || status !== "idle" || !resolvedLocation || !visit || visit.target) return;
			if (
				visit.key !== locationKey(location) ||
				visit.key !== locationKey(resolvedLocation) ||
				visit.key !== locationKey(router.latestLocation)
			)
				return;
			const target = routeToRecent(visit.pathname);
			if (target && key[2] === target.key.slice(target.kind.length + 1)) recordResolved();
		});
		update(queryClient, (entries) => entries);
		if (router.state.status === "idle" && router.state.matches.length > 0) recordResolved();
		return () => {
			unsubscribeBefore();
			unsubscribeResolved();
			unsubscribeIdentity();
		};
	}, [router, queryClient]);

	useEffect(
		() =>
			subscribeSessionRemovals((sessionId) => {
				update(queryClient, (entries) =>
					remove(remove(entries, `session:${sessionId}`), `subagents:${sessionId}`),
				);
			}),
		[subscribeSessionRemovals, queryClient],
	);
}
