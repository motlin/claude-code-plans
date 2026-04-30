import {createFileRoute, Link} from '@tanstack/react-router';
import {queryOptions, useSuspenseQuery} from '@tanstack/react-query';
import {ArrowLeft, GitFork} from 'lucide-react';
import {getSessionSubagents} from '../lib/server-fns';
import {SubagentGantt} from '../components/subagent-gantt';
import {SubagentSequence} from '../components/subagent-sequence';
import {DetailTopBar, pillStyles} from '../components/detail-top-bar';
import {useSettings} from '../components/settings-provider';

const subagentQueryOptions = (sessionId: string) =>
	queryOptions({
		queryKey: ['session', sessionId, 'subagents'] as const,
		queryFn: () => getSessionSubagents({data: sessionId}),
		staleTime: Infinity,
		gcTime: Infinity,
	});

export const Route = createFileRoute('/session/$id_/subagents')({
	component: SubagentsPage,
	loader: ({context: {queryClient}, params}) => queryClient.ensureQueryData(subagentQueryOptions(params.id)),
	head: ({params}) => ({
		meta: [{title: `Subagents - ${params.id.slice(0, 8)}`}],
	}),
});

function SubagentsPage() {
	const params = Route.useParams();
	const {data} = useSuspenseQuery(subagentQueryOptions(params.id));
	const {settings} = useSettings();
	const subagentView = settings.defaultSubagentView;

	return (
		<div>
			<DetailTopBar>
				<Link
					to="/session/$id"
					params={{id: params.id}}
					className={pillStyles.primary}
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					Back to session
				</Link>
			</DetailTopBar>

			<h1 className="text-lg font-semibold flex items-center gap-2">
				<GitFork className="h-4 w-4 text-text-500" />
				Subagents ({data.totalCount})
			</h1>

			{data.totalCount === 0 ? (
				<p className="mt-4 text-sm text-text-500">No subagents for this session.</p>
			) : (
				<div className="mt-3">
					{subagentView === 'sequence' ? (
						<SubagentSequence agents={data.agents} />
					) : (
						<SubagentGantt agents={data.agents} />
					)}
				</div>
			)}
		</div>
	);
}
