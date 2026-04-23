import {createFileRoute, Link} from '@tanstack/react-router';
import {useSuspenseQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {Pencil} from 'lucide-react';
import {settingsQueryOptions} from '../queries/settings';

export const Route = createFileRoute('/settings')({
	component: SettingsPage,
	loader: ({context: {queryClient}}) => queryClient.ensureQueryData(settingsQueryOptions),
	head: () => ({
		meta: [{title: 'Settings'}],
	}),
});

const FILE_LABELS = ['settings.json', 'settings.local.json'] as const;

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
			className="text-xs px-2 py-1 rounded bg-bg-200 hover:bg-bg-300 text-text-200 cursor-pointer"
		>
			{copied ? 'Copied' : 'Copy'}
		</button>
	);
}

function SettingsPage() {
	const {data: files} = useSuspenseQuery(settingsQueryOptions);

	return (
		<div className="max-w-4xl">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-semibold">Settings</h1>
					<p className="mt-1 text-sm text-text-500">
						Claude Code configuration files from <code className="font-mono text-xs">~/.claude/</code>
					</p>
				</div>
				<Link
					to="/settings/edit"
					className="flex items-center gap-1.5 rounded-md bg-accent-100 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-100/80"
				>
					<Pencil className="h-3.5 w-3.5" />
					Edit
				</Link>
			</div>

			<div className="mt-6 space-y-8">
				{files.map((file, index) => (
					<section key={file.path}>
						<div className="flex items-center justify-between mb-2">
							<div>
								<h2 className="text-sm font-semibold text-text-100">{FILE_LABELS[index]}</h2>
								<p className="text-xs text-text-500 font-mono mt-0.5">{file.path}</p>
							</div>
							{file.exists && <CopyButton text={file.content} />}
						</div>
						{file.exists ? (
							<div
								className="rounded-md overflow-x-auto text-sm [&_pre]:!rounded-md [&_pre]:!p-4"
								dangerouslySetInnerHTML={{__html: file.renderedHtml}}
							/>
						) : (
							<p className="text-sm text-text-500 italic">File does not exist.</p>
						)}
					</section>
				))}
			</div>
		</div>
	);
}
