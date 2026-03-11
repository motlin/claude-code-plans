import {createFileRoute, Link} from '@tanstack/react-router';
import {getSessions} from '../lib/server-fns';

export const Route = createFileRoute('/sessions')({
	component: SessionsPage,
	loader: () => getSessions(),
	head: () => ({
		meta: [{title: 'Claude Sessions'}],
	}),
});

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

const RECENT_LIMIT = 20;
const PER_PROJECT_LIMIT = 10;

function SessionsPage() {
	const groups = Route.useLoaderData();

	const allSessions = groups
		.flatMap((g) => g.sessions)
		.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
		.slice(0, RECENT_LIMIT);

	return (
		<div>
			<h1 className="text-lg font-semibold">Claude Sessions</h1>

			{groups.length === 0 ? (
				<p className="mt-4 text-muted-foreground">No session files found.</p>
			) : (
				<>
					<div className="mt-6">
						<h2 className="border-b border-border pb-1 text-sm font-semibold">Recent</h2>
						<ul className="mt-2 space-y-1">
							{allSessions.map((sess) => (
								<SessionItem
									key={sess.id}
									session={sess}
								/>
							))}
						</ul>
					</div>

					<div className="mt-8">
						<h2 className="border-b border-border pb-1 text-sm font-semibold">By Project</h2>
						{groups.map((group) => {
							const shown = group.sessions.slice(0, PER_PROJECT_LIMIT);
							const remaining = group.sessions.length - shown.length;
							return (
								<div
									key={group.project}
									className="mt-4"
								>
									<h3 className="text-sm font-medium text-muted-foreground">
										<Link
											to="/project/$id"
											params={{id: group.project}}
											className="hover:underline"
										>
											{group.projectName}
										</Link>
										<span className="ml-1.5 text-xs font-normal">({group.sessions.length})</span>
									</h3>
									<ul className="mt-1 space-y-1">
										{shown.map((sess) => (
											<SessionItem
												key={sess.id}
												session={sess}
											/>
										))}
									</ul>
									{remaining > 0 && (
										<Link
											to="/project/$id"
											params={{id: group.project}}
											className="mt-1 block px-2 text-xs text-primary hover:underline"
										>
											{remaining} more sessions &rarr;
										</Link>
									)}
								</div>
							);
						})}
					</div>
				</>
			)}
		</div>
	);
}

function SessionItem({
	session,
}: {
	session: {
		id: string;
		title: string;
		summary?: string | undefined;
		mtime: string;
		projectName: string;
		messageCount: number;
		gitBranch?: string | undefined;
	};
}) {
	return (
		<li>
			<Link
				to="/session/$id"
				params={{id: session.id}}
				className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-muted/50"
			>
				<div
					className="truncate"
					style={{fontSize: '14px', fontWeight: 430}}
				>
					{session.title}
				</div>
				<div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
					<span>{session.projectName}</span>
					<span>&middot;</span>
					<span>{formatDate(session.mtime)}</span>
					{session.messageCount > 0 && (
						<>
							<span>&middot;</span>
							<span>{session.messageCount} msgs</span>
						</>
					)}
					{session.gitBranch && (
						<>
							<span>&middot;</span>
							<span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
								{session.gitBranch}
							</span>
						</>
					)}
				</div>
				{session.summary && session.summary !== session.title && (
					<div className="mt-0.5 truncate text-xs text-muted-foreground italic">{session.summary}</div>
				)}
			</Link>
		</li>
	);
}
