import {createFileRoute, Link} from '@tanstack/react-router';
import {useSuspenseQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {sourceFileQueryOptions} from '../lib/api/source';

export const Route = createFileRoute('/source/$kind/$')({
	component: GenericSourcePage,
	loader: ({context: {queryClient}, params}) =>
		queryClient.ensureQueryData(sourceFileQueryOptions(params.kind, params._splat ?? '')),
	head: ({params}) => {
		const tail = (params._splat ?? '').split('/').pop() ?? params.kind;
		return {meta: [{title: `Source: ${tail}`}]};
	},
});

function CopyButton({text}: {text: string}) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(text);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch {
					// clipboard not available
				}
			}}
			className="text-xs px-2 py-1 rounded bg-bg-200 hover:bg-bg-300 text-text-200"
		>
			{copied ? 'Copied' : 'Copy'}
		</button>
	);
}

function prettyJson(content: string): string {
	try {
		return JSON.stringify(JSON.parse(content), null, 2);
	} catch {
		return content;
	}
}

const KIND_LABELS: Record<string, string> = {
	plan: 'Plan',
	memory: 'Memory',
	task: 'Task',
	command: 'Command',
};

const BACK_LINKS: Record<string, {to: string; label: string}> = {
	plan: {to: '/plans', label: 'All Plans'},
	memory: {to: '/memories', label: 'All Memories'},
	task: {to: '/tasks', label: 'All Tasks'},
	command: {to: '/plugins', label: 'All Plugins'},
};

function GenericSourcePage() {
	const {kind, _splat} = Route.useParams();
	const relativePath = _splat ?? '';
	const {data} = useSuspenseQuery(sourceFileQueryOptions(kind, relativePath));
	const back = BACK_LINKS[kind];
	const kindLabel = KIND_LABELS[kind] ?? kind;

	if (!data) {
		return (
			<div className="mx-auto max-w-3xl p-6">
				<h1 className="text-lg font-medium text-text-100 mb-2">Source not found</h1>
				<p className="text-sm text-text-500 mb-4">
					No {kindLabel.toLowerCase()} source file at <code className="font-mono">{relativePath}</code>.
				</p>
				{back && (
					<Link
						to={back.to}
						className="text-accent-100 text-sm hover:underline"
					>
						← {back.label}
					</Link>
				)}
			</div>
		);
	}

	const display = data.language === 'json' ? prettyJson(data.content) : data.content;
	const truncated = display.length > 200_000;
	const shown = truncated ? display.slice(0, 200_000) + '\n\n... [truncated]' : display;

	return (
		<div className="mx-auto max-w-4xl p-6 space-y-6">
			<div>
				{back && (
					<Link
						to={back.to}
						className="text-accent-100 text-sm hover:underline"
					>
						← {back.label}
					</Link>
				)}
				<h1 className="text-lg font-medium text-text-100 mt-1">
					{kindLabel} source · {data.relativePath}
				</h1>
				<p className="text-xs text-text-500 mt-1 font-mono break-all">{data.absolutePath}</p>
			</div>

			<section>
				<div className="flex items-center justify-between mb-2">
					<h2 className="text-sm font-medium text-text-200">
						Raw {data.language === 'json' ? 'JSON' : 'markdown'}
					</h2>
					<CopyButton text={data.content} />
				</div>
				<pre className="bg-bg-100 text-text-000 text-xs font-mono whitespace-pre-wrap break-all rounded p-3 overflow-x-auto leading-relaxed">
					{shown}
				</pre>
			</section>
		</div>
	);
}
