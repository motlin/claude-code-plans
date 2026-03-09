import {createFileRoute, Link} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {listMemories} from '../lib/memory';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

const getMemories = createServerFn({method: 'GET'}).handler(async () => {
	const groups = await listMemories(PROJECTS_DIR);
	return groups.map((g) => ({
		project: g.project,
		projectName: g.projectName,
		memories: g.memories.map((m) => ({
			filename: m.filename,
			title: m.title,
			mtime: m.mtime.toISOString(),
			project: m.project,
		})),
	}));
});

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
				<p className="mt-4 text-muted-foreground">No memory files found.</p>
			) : (
				groups.map((group) => (
					<div
						key={group.project}
						className="mt-6"
					>
						<h2 className="border-b border-border pb-1 text-sm font-semibold">{group.projectName}</h2>
						<ul className="mt-2 space-y-2">
							{group.memories.map((mem) => (
								<li key={`${mem.project}/${mem.filename}`}>
									<Link
										to="/memory/$project/$filename"
										params={{project: mem.project, filename: mem.filename}}
										className="flex items-center justify-between rounded-md border border-border px-4 py-3 transition-colors hover:bg-muted/50"
									>
										<span className="text-sm font-medium">{mem.title}</span>
										<span className="ml-4 shrink-0 text-xs text-muted-foreground">
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
