import {isSessionRouteAlias} from "../lib/session-route-alias";
import {useEffect, useRef} from "react";
import {useRouter, useRouterState} from "@tanstack/react-router";
import {useQueryClient, type QueryClient} from "@tanstack/react-query";

import {useSubscribeSessionRemovals} from "./use-claude-events";
import
{
	loadRecents,
	push,
	remove,
	retitle,
	routeToRecent,
	resolveRecentSession,
	resolveRecentSessions,
	saveRecents,
	type RecentEntry,
	type RecentTarget,
} from "../lib/recents-history";
import {getCachedSessionIdentity} from "../lib/api/session-identity";
import {sessionDetailQueryOptions, sessionQueryKeys} from "../lib/api/sessions";
import {resolvedPageTitle} from "../lib/route-title";
import {eventQueryKey} from "../lib/query-cache-event";

type AppRouter = ReturnType<typeof useRouter>;

function update(queryClient: QueryClient, change: (entries: RecentEntry[]) => RecentEntry[]): void
{
	const entries = resolveRecentSessions(loadRecents(), (alias) => getCachedSessionIdentity(queryClient, alias));
	saveRecents(change(entries));
}

function resolvedTarget(queryClient: QueryClient, pathname: string): RecentTarget | null
{
	const resolved = routeToRecent(pathname, (alias) => getCachedSessionIdentity(queryClient, alias));
	if (!resolved) return null;
	if (
		(resolved.kind === "session" || resolved.kind === "subagents") &&
		isSessionRouteAlias(resolved.key.slice(resolved.kind.length + 1))
	)
		return null;
	return resolved;
}

function locationKey(location: AppRouter["state"]["location"]): string
{
	return location.state.__TSR_key ?? location.href;
}

type RouterMatches = AppRouter["state"]["matches"];

/**
 * A page that 404s is not a place to switch back to: a loader that threw `notFound()` or errored,
 * or a route whose head reports the missing record ("Session Not Found").
 */
function resolvedToNotFound(matches: RouterMatches, title: string | null): boolean
{
	// A not-found that reaches the root boundary (unmatched URL, or a loader's notFound() with no closer
	// notFoundComponent) leaves that match "success" and flags it `_notFound` instead.
	if (matches.some((match) => match.status === "notFound" || match.status === "error" || match._notFound === true))
	{
		return true;
	}
	return title?.endsWith(" Not Found") === true;
}

/** What the recorder files a settled page under; null while a navigation is pending. */
function settledPageKey(status: AppRouter["state"]["status"], matches: RouterMatches): string | null
{
	if (status !== "idle") return null;
	const title = resolvedPageTitle(matches);
	return JSON.stringify([title, resolvedToNotFound(matches, title)]);
}

/**
 * Feeds the per-tab recents MRU behind the ⌃Q switcher. Every resolved navigation pushes its page
 * under its route's page title; a session being left is retitled from its cached detail so renames
 * stick (the tab title is always "Claude Code", so it names nothing). Pages that resolve to
 * not-found, and sessions the index drops, are pruned.
 */
export function useRecentsRecorder(): void
{
	const router = useRouter();
	const queryClient = useQueryClient();
	const subscribeSessionRemovals = useSubscribeSessionRemovals();
	const recordSettled = useRef<(() => void) | null>(null);
	// onResolved fires before stale loaders revalidate in the background, so a page whose title or
	// not-found state changes once they land is recorded again.
	const settledPage = useRouterState(
		{
			select: (state) => settledPageKey(state.status, state.matches),
		},
	);

	useEffect(() =>
	{
		let visit:
		{
			key: string;
			pathname: string;
			target: RecentTarget | null;
		} | null = null;
		let navigating = false;
		const recordResolved = () =>
		{
			const location = router.state.location;
			if (!routeToRecent(location.pathname))
			{
				visit = null;
				return;
			}
			const key = locationKey(location);
			if (visit?.key !== key || visit.pathname !== location.pathname)
			{
				visit =
				{
					key,
					pathname: location.pathname,
					target: null,
				};
			}
			// Pin a visit's first local owner even if its alias later becomes ambiguous or changes owner.
			visit.target ??= resolvedTarget(queryClient, location.pathname);
			if (!visit.target) return;
			const target = resolveRecentSession(visit.target, (alias) => getCachedSessionIdentity(queryClient, alias));
			const title = resolvedPageTitle(router.state.matches);
			if (resolvedToNotFound(router.state.matches, title))
			{
				update(queryClient, (entries) => remove(entries, target.key));
				return;
			}
			update(queryClient, (entries) =>
				push(
					entries,
					title === null
						? target
						:
							{
								...target,
								title,
							},
				),
			);
		};
		const unsubscribeBefore = router.subscribe("onBeforeNavigate", ({fromLocation}) =>
		{
			navigating = true;
			const left = fromLocation
				? visit?.key === locationKey(fromLocation) && visit.pathname === fromLocation.pathname
					? visit.target
					: resolvedTarget(queryClient, fromLocation.pathname)
				: null;
			if (left?.kind !== "session") return;
			const {key} = resolveRecentSession(left, (alias) => getCachedSessionIdentity(queryClient, alias));
			const title = queryClient.getQueryData(
				sessionDetailQueryOptions(key.slice("session:".length)).queryKey,
			)?.title;
			if (title === undefined || title === "") return;
			update(queryClient, (entries) => retitle(entries, key, title));
		});
		const unsubscribeResolved = router.subscribe("onResolved", () =>
		{
			navigating = false;
			recordResolved();
		});
		const [sessionRoot, identityRoot] = sessionQueryKeys.identities();
		const unsubscribeIdentity = queryClient.getQueryCache().subscribe((event) =>
		{
			if (event.type !== "added" && event.type !== "updated" && event.type !== "removed") return;
			const key = eventQueryKey(event);
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
		recordSettled.current = () =>
		{
			if (!navigating) recordResolved();
		};
		if (router.state.status === "idle" && router.state.matches.length > 0) recordResolved();
		return () =>
		{
			recordSettled.current = null;
			unsubscribeBefore();
			unsubscribeResolved();
			unsubscribeIdentity();
		};
	}, [router, queryClient]);

	useEffect(() =>
	{
		if (settledPage !== null) recordSettled.current?.();
	}, [settledPage]);

	useEffect(
		() =>
			subscribeSessionRemovals((sessionId) =>
			{
				update(queryClient, (entries) =>
					remove(remove(entries, `session:${sessionId}`), `subagents:${sessionId}`),
				);
			}),
		[subscribeSessionRemovals, queryClient],
	);
}
