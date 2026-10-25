import {useQuery} from "@tanstack/react-query";
import {useRouter, useRouterState} from "@tanstack/react-router";
import {useEffect, useRef} from "react";
import {activeSessionsQueryOptions} from "../lib/api/sessions";
import {prefetchWhenIdle} from "../lib/idle-prefetch";
import {waitingSessionsToPrefetch} from "../lib/waiting-session-prefetch";
import {useSettings} from "./settings-context";

/**
 * Loads the sessions waiting on the reader once the page is idle, the way a hover over their sidebar row would, so
 * moving on to the next one after answering this one paints from cache. The route preload also warms the server's
 * transcript index and provenance for a big transcript before the click instead of on it.
 */
export function WaitingSessionPrefetch() {
	const router = useRouter();
	const {settings} = useSettings();
	const {data: activeSessions} = useQuery(activeSessionsQueryOptions(settings.activeTimeoutSec * 1000));
	const openSessionId = useRouterState({
		select: (state) => state.matches.find((match) => match.routeId === "/session/$id")?.params.id,
	});
	const warmed = useRef(new Set<string>());

	useEffect(() => {
		if (import.meta.env.MODE === "test" || activeSessions === undefined) return undefined;
		const ids = waitingSessionsToPrefetch(activeSessions, {openSessionId, warmed: warmed.current});
		if (ids.length === 0) return undefined;
		return prefetchWhenIdle(
			ids.map((id) => async () => {
				warmed.current.add(id);
				return router.preloadRoute({to: "/session/$id", params: {id}});
			}),
		);
	}, [activeSessions, openSessionId, router]);
	return null;
}
