import {createFileRoute, Link} from '@tanstack/react-router';
import {getPluginFileRendered} from '../lib/server-fns';
import {MarkdownArticle} from '../components/markdown-article';
import {ArrowLeft} from 'lucide-react';
import {DetailTopBar, pillStyles} from '../components/detail-top-bar';

const getFile = getPluginFileRendered;

export const Route = createFileRoute('/plugin/$id/$type/$path')({
	component: PluginFilePage,
	loader: ({params}) =>
		getFile({data: {pluginId: params.id, pathSegments: [params.type, ...params.path.split('/')]}}),
	head: ({loaderData}) => ({
		meta: [{title: loaderData?.title ?? 'Plugin File'}],
	}),
});

function FrontmatterBadge({label, value}: {label: string; value: string}) {
	return (
		<div className="flex items-center gap-1.5 rounded-md bg-bg-200/60 px-2.5 py-1 text-xs">
			<span className="font-medium text-text-400">{label}</span>
			<span className="text-text-200">{value}</span>
		</div>
	);
}

function PluginFilePage() {
	const data = Route.useLoaderData();
	const {id} = Route.useParams();

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
				<h1 className="mt-4 text-lg font-semibold">File Not Found</h1>
				<p className="mt-2 text-text-500">This plugin file could not be found.</p>
			</div>
		);
	}

	const fm = data.frontmatter;
	const badges = Object.entries(fm).filter(([key]) => !['name', 'description'].includes(key) && fm[key]);

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
				<span className="text-xs text-text-500">{id.split('@')[0]}</span>
			</DetailTopBar>

			{fm['description'] && <p className="mt-3 text-sm text-text-400">{fm['description']}</p>}

			{badges.length > 0 && (
				<div className="mt-3 flex flex-wrap gap-2">
					{badges.map(([key, value]) => (
						<FrontmatterBadge
							key={key}
							label={key}
							value={value}
						/>
					))}
				</div>
			)}

			<div className="mt-4">
				<MarkdownArticle html={data.html} />
			</div>
		</div>
	);
}
