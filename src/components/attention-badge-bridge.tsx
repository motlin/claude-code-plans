import {useEffect} from "react";
import {useRouter} from "@tanstack/react-router";
import {useQueryClient} from "@tanstack/react-query";

import {useSubscribeSessionStates} from "../hooks/use-claude-events";
import {countSessionsNeedingAttention, stripAttentionCount} from "../lib/attention";
import {resolvedRouteTitle} from "../lib/route-title";
import {displayState, type ActivityState} from "../lib/session-state";
import {hasUnseenWork, subscribeUnseenWork} from "../lib/unread-store";
import {useSettings} from "./settings-provider";
import {getCachedSessionIdentity} from "../lib/api/session-identity";
import {sessionQueryKeys} from "../lib/api/sessions";

function viewedRouteId(router: ReturnType<typeof useRouter>): string | null {
	const sessionMatch = router.state.matches.find((match) => match.routeId.startsWith("/session/$id"));
	if (!sessionMatch || !("id" in sessionMatch.params)) return null;
	const id = sessionMatch.params.id;
	return typeof id === "string" ? id : null;
}

/**
 * Title the current route asks for. Snapshotting `document.title` instead would pin the badge to
 * whichever route was hard loaded and re-assert it over every later route's title.
 */
function routeTitle(router: ReturnType<typeof useRouter>): string {
	return resolvedRouteTitle(router.state.matches) ?? stripAttentionCount(document.title);
}

function setAppBadge(count: number): void {
	if (count > 0 && typeof navigator.setAppBadge === "function") {
		navigator.setAppBadge(count).catch(() => {});
	} else if (count === 0 && typeof navigator.clearAppBadge === "function") {
		navigator.clearAppBadge().catch(() => {});
	}
}

/** Side-effect-only component that mirrors the live attention count to browser chrome. */
export function AttentionBadgeBridge(): null {
	const {settings} = useSettings();
	const subscribeSessionStates = useSubscribeSessionStates();
	const router = useRouter();
	const queryClient = useQueryClient();

	useEffect(() => {
		if (typeof document === "undefined" || typeof navigator === "undefined") return;

		const activityStates = new Map<string, {state: ActivityState; archived: boolean}>();

		const updateBadge = () => {
			const sessions = Array.from(activityStates, ([sessionId, {state, archived}]) => ({
				sessionId,
				displayState: displayState(state, hasUnseenWork(sessionId)),
				archived,
			}));
			const viewedSessionId = getCachedSessionIdentity(queryClient, viewedRouteId(router));
			const count = countSessionsNeedingAttention(sessions, settings, document.hidden, viewedSessionId);
			const title = routeTitle(router);
			document.title = count > 0 ? `(${count}) ${title}` : title;
			setAppBadge(count);
		};

		const unsubscribeUnseenWork = subscribeUnseenWork(updateBadge);
		const unsubscribeSessionStates = subscribeSessionStates((session) => {
			activityStates.set(session.sessionId, {
				state: session.state,
				archived: session.archived,
			});
			updateBadge();
		});
		const unsubscribeRouter = router.subscribe("onResolved", updateBadge);
		const [sessionRoot, identityRoot] = sessionQueryKeys.identities();
		const unsubscribeIdentity = queryClient.getQueryCache().subscribe((event) => {
			if (event.type !== "added" && event.type !== "updated" && event.type !== "removed") return;
			const key = event.query.queryKey;
			if (key[0] === sessionRoot && key[1] === identityRoot && key[2] === viewedRouteId(router)) updateBadge();
		});
		document.addEventListener("visibilitychange", updateBadge);
		updateBadge();

		return () => {
			unsubscribeSessionStates();
			unsubscribeUnseenWork();
			unsubscribeRouter();
			unsubscribeIdentity();
			document.removeEventListener("visibilitychange", updateBadge);
			document.title = routeTitle(router);
			if (typeof navigator.clearAppBadge === "function") {
				navigator.clearAppBadge().catch(() => {});
			}
		};
	}, [router, settings, subscribeSessionStates, queryClient]);

	return null;
}
