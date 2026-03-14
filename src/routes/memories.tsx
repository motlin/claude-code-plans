import {createFileRoute, Link} from '@tanstack/react-router';
import {getMemories} from '../lib/server-fns';

export const Route = createFileRoute('/memories')({
	component: MemoriesPage,
	loader: () => getMemories(),
	head: () => ({
		meta: [{title: 'Claude Memories'}],
	}),
});

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC',
	});
}

function MemoriesPage() {
	const groups = Route.useLoaderData();

	return (
		<div>
			<h1 className="text-lg font-semibold">Claude Memories</h1>

			{groups.length === 0 ? (
				<p className="mt-4 text-text-500">No memory files found.</p>
			) : (
				groups.map((group) => (
					<div
						key={group.project}
						className="mt-6"
					>
						<h2 className="border-b border-border-300/15 pb-1 text-sm font-semibold">
							{group.projectName}
						</h2>
						<ul className="mt-2 space-y-2">
							{group.memories.map((mem) => (
								<li key={`${mem.project}/${mem.filename}`}>
									<Link
										to="/memory/$project/$filename"
										params={{project: mem.project, filename: mem.filename}}
										className="flex items-center justify-between rounded-md border border-border-300/15 px-4 py-3 transition-colors hover:bg-bg-200/50"
									>
										<span className="text-sm font-medium">{mem.title}</span>
										<span className="ml-4 shrink-0 text-xs text-text-500">
											{formatDate(mem.mtime)}
										</span>
									</Link>
								</li>
							))}
						</ul>
					</div>
				))
			)}
		</div>
	);
}
