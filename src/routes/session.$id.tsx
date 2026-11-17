import {pageTitle} from "../lib/route-title";
import {isSessionRouteAlias} from "../lib/session-route-alias";
import type {MainScrollRestorationSnapshot} from "../hooks/use-main-scroll-restoration";
import {SessionRouteIdentity} from "../components/session-route-identity";
import
{
	getCachedCanonicalSessionRouteId,
	sessionIdentityFailure,
	sessionIdentityQueryOptions,
} from "../lib/api/session-identity";
import {sessionScrollKey} from "../lib/session-route-location";
import {createFileRoute, useLocation, useRouter} from "@tanstack/react-router";
import {noop, useQueries, useQuery, useQueryClient} from "@tanstack/react-query";
import {lazy, Suspense, useCallback, useEffect, useRef} from "react";
import {SessionPage} from "../components/session-page";
import {SessionErrorComponent} from "../components/session-error";
import {TerminalHold} from "../components/terminal-view/terminal-hold";
import {herdrPanesQueryOptions} from "../lib/api/herdr";
import {validateSessionSearch} from "../lib/session-search";
import {sessionDetailQueryOptions, sessionSubagentsQueryOptions, transcriptQueryOptions} from "../lib/api/sessions";

// Upstream lazy-loads its terminal view (`epitaxy_terminal_view`, tier T3) behind the hold screen.
const TerminalSession = lazy(async () =>
	import("../components/terminal-view/terminal-session").then((module) => (
	{
		default: module.TerminalSession,
	})),
);

export const Route = createFileRoute("/session/$id")(
	{
		component: SessionRouteComponent,
		staticData:
		{
			tileShell: "session",
		},
		validateSearch: validateSessionSearch,
		// Warm the caches without awaiting them. With `ssr: false` nothing paints
		// until every matched loader resolves, and a long session's transcript runs
		// to megabytes of JSONL, so awaiting here means a blank white page. The
		// component renders the shell plus a skeleton instead. Reading the detail
		// cache is synchronous, so a warm visit still titles the tab immediately.
		// Synchronous, so blocking costs nothing: navigating onto a preloaded match then commits fresh loaderData
		// instead of the preload snapshot, and useSessionHeadTitle has no stale title to invalidate.
		loader:
		{
			staleReloadMode: "blocking",
			handler: ({context: {queryClient}, params}) =>
			{
				let sessionId = params.id;
				if (isSessionRouteAlias(sessionId))
				{
					const options = sessionIdentityQueryOptions(sessionId);
					const identity = queryClient.getQueryState(options.queryKey);
					// A title refresh must not restart a terminal failure's automatic retries.
					if (identity?.status === "error")
						return {
							title: sessionIdentityFailure(identity.error).title,
						};
					void queryClient.query(options).catch(noop);
					if (
						identity?.status !== "success" ||
						!identity.data ||
						identity.isInvalidated ||
						identity.fetchStatus !== "idle"
					)
						return undefined;
					sessionId = identity.data.sessionId;
				}
				void queryClient.query(sessionDetailQueryOptions(sessionId)).catch(noop);
				void queryClient.query(transcriptQueryOptions(sessionId)).catch(noop);
				void queryClient.query(sessionSubagentsQueryOptions(sessionId)).catch(noop);
				void queryClient.query(herdrPanesQueryOptions).catch(noop);
				// Bound before returning: as a return expression, getQueryData infers its data type from the loader (any).
				const detail = queryClient.getQueryData(sessionDetailQueryOptions(sessionId).queryKey);
				return detail;
			},
		},
		errorComponent: SessionErrorComponent,
		head: ({loaderData}) => (
		{
			meta: [pageTitle(sessionHeadTitle(loaderData))],
		}),
	},
);

/**
 * A pending session is not a missing session. `undefined` means the detail
 * query is still in flight; only `null` — what the API returns for an unknown
 * id — is a genuine 404.
 */
export function sessionHeadTitle(
	detail:
		|
		  {
				title: string;
		  }
		| null
		| undefined,
): string
{
	if (detail === undefined) return "Loading session…";
	if (detail === null) return "Session Not Found";
	return detail.title;
}

/**
 * `head` runs with the loader's synchronous snapshot of the detail cache, so a
 * cold visit titles the tab "Loading session…". Re-run this route's loader once
 * the query lands so the tab picks up the real title.
 */
function useSessionHeadTitle(sessionId: string)
{
	const router = useRouter();
	const loaderData = Route.useLoaderData();
	const query = useQuery(sessionDetailQueryOptions(sessionId));
	const detail = query.data;

	useEffect(() =>
	{
		if (detail === undefined) return;
		if (sessionHeadTitle(loaderData) === sessionHeadTitle(detail)) return;
		void router.invalidate(
			{
				filter: (match) => match.routeId === Route.id,
			},
		);
	}, [detail, loaderData, router]);
	return query;
}

function SessionRouteComponent()
{
	const params = Route.useParams();
	return (
		<SessionRouteIdentity routeId={params.id} captureScrollRestoration>
			{(sessionId, routeId, scrollKey, scrollRestoration) => (
				<ResolvedSessionRoute
					sessionId={sessionId}
					routeId={routeId}
					scrollKey={scrollKey}
					scrollRestoration={scrollRestoration}
				/>
			)}
		</SessionRouteIdentity>
	);
}

function ResolvedSessionRoute({
	sessionId,
	routeId,
	scrollKey,
	scrollRestoration,
}: {
	sessionId: string;
	routeId: string;
	scrollKey: string;
	scrollRestoration?: MainScrollRestorationSnapshot | undefined;
})
{
	const router = useRouter();
	const {pane, view} = Route.useSearch();
	const navigate = Route.useNavigate();
	const detail = useSessionHeadTitle(sessionId);
	useCanonicalSessionRoute(sessionId, routeId, detail);
	const params = Route.useParams();
	// The deep link is a one-shot request: drop it once the pane opened so a
	// reload or Back does not reopen a pane the user has since closed.
	const clearRequestedPane = useCallback(() =>
	{
		void navigate(
			{
				search: (previous) =>
					previous.view === undefined
						? {}
						:
							{
								view: previous.view,
							},
				state: (state) => (
				{
					...state,
					sessionIdentity:
					{
						sessionId,
						routeId,
						...(state.sessionIdentity?.aliasRouteId
							?
								{
									aliasRouteId: state.sessionIdentity.aliasRouteId,
								}
							: {}),
						...(isSessionRouteAlias(params.id)
							?
								{
									aliasRouteId: params.id,
								}
							: {}),
						scrollKey: sessionScrollKey(router.state.location, sessionId),
					},
				}),
				hash: true,
				replace: true,
				resetScroll: false,
				hashScrollIntoView: false,
			},
		);
	}, [navigate, router, sessionId, routeId, params.id]);

	// Upstream `CPe`: the terminal view replaces the whole session column.
	if (view === "terminal")
		return (
			<Suspense fallback={<TerminalHold />}>
				<TerminalSession sessionId={sessionId} />
			</Suspense>
		);

	return (
		<SessionPage
			sessionId={sessionId}
			routeId={routeId}
			scrollKey={scrollKey}
			scrollRestoration={scrollRestoration}
			requestedPane={pane}
			onRequestedPaneHandled={clearRequestedPane}
		/>
	);
}

/** Keep the local UUID data identity while exposing its verified Remote Control URL. */
function useCanonicalSessionRoute(
	sessionId: string,
	initialRouteId: string,
	detail: ReturnType<typeof useSessionHeadTitle>,
)
{
	const router = useRouter();
	const queryClient = useQueryClient();
	const location = useLocation();
	const params = Route.useParams();
	const entryKey = sessionScrollKey(location, sessionId);
	const visit = useRef(
		{
			entryKey,
			seeded: new Set<string>(),
		},
	);
	const replacing = useRef<string | undefined>(undefined);
	if (visit.current.entryKey !== entryKey)
		visit.current =
		{
			entryKey,
			seeded: new Set<string>(),
		};
	// An explicitly opened historical alias is already the user's chosen URL.
	const canonical = isSessionRouteAlias(initialRouteId) ? undefined : detail.data?.canonicalRouteId;
	const freshDetail =
		canonical !== undefined &&
		detail.isSuccess &&
		!detail.isStale &&
		!detail.isFetching &&
		!detail.data?.canonicalRoutePending;
	const canSeed =
		freshDetail &&
		!visit.current.seeded.has(canonical) &&
		queryClient.getQueryState(sessionIdentityQueryOptions(canonical).queryKey) === undefined;
	const queries: ReturnType<typeof sessionIdentityQueryOptions>[] =
		canonical === undefined || (!freshDetail && !visit.current.seeded.has(canonical))
			? []
			: [
					{
						...sessionIdentityQueryOptions(canonical),
						enabled: freshDetail,
						initialData: () =>
						{
							if (!canSeed) return undefined;
							return {
								sessionId,
							};
						},
						initialDataUpdatedAt: detail.dataUpdatedAt,
					},
				];
	const [identity] = useQueries(
		{
			queries,
		},
	);

	if (canonical !== undefined && freshDetail) visit.current.seeded.add(canonical);

	useEffect(() =>
	{
		if (!freshDetail || params.id !== sessionId || location.pathname !== `/session/${sessionId}`) return;
		if (!identity?.isSuccess || identity.isStale || identity.isFetching || identity.data.sessionId !== sessionId)
			return;
		if (router.latestLocation.state.__TSR_key !== location.state.__TSR_key) return;
		if (getCachedCanonicalSessionRouteId(queryClient, sessionId) !== canonical) return;
		const nativeKey = location.state.__TSR_key ?? location.href;
		if (replacing.current === nativeKey) return;
		replacing.current = nativeKey;
		void router.navigate(
			{
				to: "/session/$id",
				params:
				{
					id: canonical,
				},
				search: true,
				hash: true,
				state:
				{
					...location.state,
					sessionIdentity:
					{
						sessionId,
						scrollKey: entryKey,
						routeId: initialRouteId,
						aliasRouteId: canonical,
					},
				},
				replace: true,
				resetScroll: false,
				hashScrollIntoView: false,
			},
		);
	}, [
		freshDetail,
		canonical,
		params.id,
		sessionId,
		identity,
		router,
		queryClient,
		location.state,
		location.href,
		location.pathname,
		entryKey,
		initialRouteId,
	]);
}
