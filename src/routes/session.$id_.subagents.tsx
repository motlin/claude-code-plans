import {createFileRoute, Link, useRouter} from "@tanstack/react-router";
import {Suspense, useEffect} from "react";
import {SessionRouteIdentity} from "../components/session-route-identity";
import {sessionIdentityFailure, sessionIdentityQueryOptions} from "../lib/api/session-identity";
import {useSuspenseQuery} from "@tanstack/react-query";
import {ArrowLeft, GitFork} from "lucide-react";
import {sessionSubagentsQueryOptions} from "../lib/api/sessions";
import {SubagentGantt} from "../components/subagent-gantt";
import {SubagentSequence} from "../components/subagent-sequence";
import {SubagentTree} from "../components/subagent-tree";
import {DetailTopBar, pillStyles} from "../components/detail-top-bar";
import {useSettings} from "../components/settings-provider";
import {useClaudeEvents} from "../hooks/use-claude-events";
import {toSubagentSessionId} from "../lib/subagents";

export const Route = createFileRoute("/session/$id_/subagents")({
	component: SubagentsPage,
	loader: ({context: {queryClient}, params}) => {
		if (params.id.startsWith("session_")) {
			const options = sessionIdentityQueryOptions(params.id);
			const identity = queryClient.getQueryState(options.queryKey);
			if (identity?.status === "error") return {title: sessionIdentityFailure(identity.error).title};
			void queryClient.prefetchQuery(options);
			const owner =
				identity?.status === "success" && !identity.isInvalidated && identity.fetchStatus === "idle"
					? identity.data?.sessionId
					: undefined;
			return {title: owner === undefined ? "Subagents" : subagentsTitle(owner)};
		}
		return queryClient
			.ensureQueryData(sessionSubagentsQueryOptions(params.id))
			.then(() => ({title: subagentsTitle(params.id)}));
	},
	head: ({loaderData}) => ({meta: [{title: loaderData?.title ?? "Subagents"}]}),
});

function subagentsTitle(sessionId: string): string {
	return `Subagents - ${sessionId.slice(0, 8)}`;
}

function SubagentsPage() {
	const params = Route.useParams();
	return (
		<SessionRouteIdentity routeId={params.id}>
			{(sessionId) => (
				<Suspense
					fallback={
						<p role="status" className="p-6">
							Loading subagents…
						</p>
					}
				>
					<ResolvedSubagentsPage sessionId={sessionId} />
				</Suspense>
			)}
		</SessionRouteIdentity>
	);
}

function ResolvedSubagentsPage({sessionId}: {sessionId: string}) {
	const {data: agents} = useSuspenseQuery(sessionSubagentsQueryOptions(sessionId));
	const router = useRouter();
	const loaderData = Route.useLoaderData();
	const title = subagentsTitle(sessionId);
	useEffect(() => {
		if (loaderData.title !== title) void router.invalidate({filter: (match) => match.routeId === Route.id});
	}, [loaderData.title, title, router]);
	const {settings} = useSettings();
	const subagentView = settings.defaultSubagentView;
	const {liveSubagents} = useClaudeEvents();
	const subagentCount = new Set([
		...agents.map((agent) => toSubagentSessionId(agent.id)),
		...[...liveSubagents.values()].filter((node) => node.sessionId === sessionId).map((node) => node.agentId),
	]).size;

	return (
		<div>
			<DetailTopBar>
				<Link to="/session/$id" params={{id: sessionId}} className={pillStyles.primary}>
					<ArrowLeft className="h-3.5 w-3.5" />
					Back to session
				</Link>
			</DetailTopBar>

			<h1 className="text-lg font-semibold flex items-center gap-2">
				<GitFork className="h-4 w-4 text-t6" />
				Subagents ({subagentCount})
			</h1>

			{subagentView === "tree" ? (
				<div className="mt-3">
					<SubagentTree agents={agents} sessionId={sessionId} />
				</div>
			) : agents.length === 0 ? (
				<p className="mt-4 text-sm text-t6">No subagents for this session.</p>
			) : (
				<div className="mt-3">
					{subagentView === "sequence" ? (
						<SubagentSequence agents={agents} />
					) : (
						<SubagentGantt agents={agents} />
					)}
				</div>
			)}
		</div>
	);
}
