import {useQueries} from "@tanstack/react-query";
import {useLocation, useRouter} from "@tanstack/react-router";
import {useEffect, useState, type ReactNode} from "react";
import {sessionIdentityFailure, sessionIdentityQueryOptions} from "../lib/api/session-identity";
import {sessionScrollKey} from "../lib/session-route-location";
import {resolvedRouteTitle} from "../lib/route-title";
import {SessionSkeleton} from "./session-skeleton";

/** Resolve a route alias before any UUID query, and retain its first verified owner for this visit. */
export function SessionRouteIdentity({
	routeId,
	children,
}: {
	routeId: string;
	children: (sessionId: string, initialRouteId: string, scrollKey: string) => ReactNode;
}) {
	const router = useRouter();
	const location = useLocation();
	const alias = routeId.startsWith("session_");
	const queries: ReturnType<typeof sessionIdentityQueryOptions>[] = alias
		? [sessionIdentityQueryOptions(routeId)]
		: [];
	const [identity] = useQueries({queries});
	const locationEntryKey = sessionScrollKey(location, routeId);
	const [visit, setVisit] = useState({entryKey: locationEntryKey, sessionId: null as string | null, routeId});
	const paramsMatchLocation = decodeURIComponent(location.pathname.split("/")[2] ?? "") === routeId;
	// Location advances before params during navigation; keep the old page tied to its old visit until they agree.
	const entryKey = paramsMatchLocation ? locationEntryKey : visit.entryKey;
	const freshOwner =
		identity?.isSuccess && !identity.isStale && !identity.isFetching ? identity.data.sessionId : null;
	let owner = visit.entryKey === entryKey ? visit.sessionId : null;
	if (!alias && paramsMatchLocation) owner = routeId;
	if (owner === null && freshOwner !== null) owner = freshOwner;
	// A fresh mount measures its actual URL; cosmetic replacements keep this mounted visit's launch ID.
	const initialRouteId = visit.entryKey === entryKey ? visit.routeId : routeId;
	if (visit.entryKey !== entryKey || visit.sessionId !== owner)
		setVisit({entryKey, sessionId: owner, routeId: initialRouteId});
	const lostOwner = alias && owner !== null && (identity?.isError || (freshOwner !== null && freshOwner !== owner));
	const failure = sessionIdentityFailure(identity?.error);
	const unresolvedError = identity?.isError && owner === null;

	useEffect(() => {
		if (!paramsMatchLocation || !unresolvedError || resolvedRouteTitle(router.state.matches) === failure.title)
			return;
		if (router.latestLocation.state.__TSR_key !== location.state.__TSR_key) return;
		// The loader reads cached errors without retrying; this only updates its title snapshot.
		void router.invalidate({filter: (match) => "id" in match.params && match.params.id === routeId});
	}, [paramsMatchLocation, unresolvedError, failure.title, router, routeId, location.state.__TSR_key]);

	useEffect(() => {
		if (!paramsMatchLocation || !lostOwner || owner === null) return;
		if (router.latestLocation.state.__TSR_key !== location.state.__TSR_key) return;
		void router.navigate({
			to: location.pathname.replace(`/session/${routeId}`, `/session/${owner}`),
			search: true,
			hash: true,
			state: {
				...location.state,
				sessionIdentity: {
					sessionId: owner,
					scrollKey: entryKey,
					routeId: initialRouteId,
					aliasRouteId: routeId,
				},
			},
			replace: true,
			resetScroll: false,
			hashScrollIntoView: false,
		});
	}, [
		paramsMatchLocation,
		lostOwner,
		owner,
		router,
		location.pathname,
		location.state,
		routeId,
		initialRouteId,
		entryKey,
	]);

	if (!alias) return children(routeId, initialRouteId, entryKey);
	if (owner !== null) return children(owner, initialRouteId, entryKey);
	if (!identity?.isError) return <SessionSkeleton />;
	return (
		<div className="p-8">
			<p role="alert">{failure.message}</p>
			<button
				type="button"
				className="mt-4 rounded-md border border-border px-3 py-1.5"
				onClick={() => void identity.refetch()}
			>
				Retry
			</button>
		</div>
	);
}
