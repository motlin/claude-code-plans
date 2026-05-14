import {Suspense} from 'react';
import {createFileRoute, Link} from '@tanstack/react-router';
import {useSuspenseQuery} from '@tanstack/react-query';
import {userCommandFileQueryOptions} from '../lib/api/plugins';
import {MarkdownSkeleton, MarkdownView} from '../components/markdown-view';
import {ArrowLeft} from 'lucide-react';
import {DetailTopBar, pillStyles} from '../components/detail-top-bar';

export const Route = createFileRoute('/command/$source/$filename')({
	component: CommandPage,
	loader: ({context: {queryClient}, params}) =>
		queryClient.ensureQueryData(userCommandFileQueryOptions(params.source, params.filename)),
	head: ({loaderData}) => ({
		meta: [{title: loaderData?.title ?? 'Command Not Found'}],
	}),
});

function CommandPage() {
	const {source, filename} = Route.useParams();
	const {data} = useSuspenseQuery(userCommandFileQueryOptions(source, filename));

	if (!data) {
		return (
			<div>
				<DetailTopBar>
					<Link
						to="/plugins"
						className={pillStyles.primary}
					>
						<ArrowLeft className="h-3.5 w-3.5" />
						All Plugins
					</Link>
				</DetailTopBar>
				<h1 className="mt-4 text-lg font-semibold">Command Not Found</h1>
				<p className="mt-2 text-text-500">This command could not be found.</p>
			</div>
		);
	}

	return (
		<div>
			<DetailTopBar>
				<Link
					to="/plugins"
					className={pillStyles.primary}
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					All Plugins
				</Link>
				<span className="text-xs text-text-500">{data.sourceName}</span>
			</DetailTopBar>
			<div className="mt-4">
				<Suspense fallback={<MarkdownSkeleton />}>
					<MarkdownView markdown={data.markdown} />
				</Suspense>
			</div>
		</div>
	);
}
