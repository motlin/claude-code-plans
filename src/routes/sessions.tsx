import {createFileRoute, Link} from '@tanstack/react-router';
import {useState} from 'react';
import {getSessions} from '../lib/server-fns';
import {useClaudeEvents} from '../hooks/use-claude-events';

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

function getTimePeriod(mtime: string): string {
	const date = new Date(mtime);
	const now = new Date();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const diffMs = startOfToday.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	const diffDays = Math.floor(diffMs / 86_400_000);

	if (diffDays <= 0) return 'Today';
	if (diffDays === 1) return 'Yesterday';
	if (diffDays <= 7) return 'Last 7 days';
	if (diffDays <= 30) return 'Last 30 days';
	return date.toLocaleDateString('en-US', {month: 'long', year: 'numeric'});
}

const INITIAL_SHOW = 50;
const PER_PROJECT_LIMIT = 10;

function SessionsPage() {
	const groups = Route.useLoaderData();
	const {activeSessions} = useClaudeEvents();
	const activeIds = new Set(activeSessions.keys());
	const [showAll, setShowAll] = useState(false);

	const allSessions = groups
		.flatMap((g) => g.sessions)
		.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

	const timePeriodGroups: Array<{period: string; sessions: typeof allSessions}> = [];
	for (const sess of allSessions) {
		const period = getTimePeriod(sess.mtime);
		const last = timePeriodGroups[timePeriodGroups.length - 1];
		if (last && last.period === period) {
			last.sessions.push(sess);
		} else {
			timePeriodGroups.push({period, sessions: [sess]});
		}
	}

	const hiddenCount = allSessions.length - INITIAL_SHOW;

	const visibleTimePeriodGroups: Array<{period: string; sessions: typeof allSessions}> = [];
	let remaining = showAll ? Infinity : INITIAL_SHOW;
	for (const group of timePeriodGroups) {
		if (remaining <= 0) break;
		const slice = group.sessions.slice(0, remaining);
		visibleTimePeriodGroups.push({period: group.period, sessions: slice});
		remaining -= slice.length;
	}

	return (
		<div>
			<h1 className="text-lg font-semibold">Claude Sessions</h1>

			{groups.length === 0 ? (
				<p className="mt-4 text-text-500">No session files found.</p>
			) : (
				<>
					<div className="mt-6">
						{visibleTimePeriodGroups.map((group) => (
							<div key={group.period}>
								<h2 className="sticky top-0 z-10 bg-bg-000 border-b border-border-300/15 pb-1 pt-2 text-sm font-semibold text-text-500">
									{group.period}
								</h2>
								<ul className="mt-2 mb-4 space-y-1">
									{group.sessions.map((sess) => (
										<SessionItem
											key={sess.id}
											session={sess}
											isActive={activeIds.has(sess.id)}
										/>
									))}
								</ul>
							</div>
						))}
						{!showAll && hiddenCount > 0 && (
							<button
								type="button"
								onClick={() => setShowAll(true)}
								className="mt-2 text-sm text-accent-100 hover:underline cursor-pointer"
							>
								Show {hiddenCount} more sessions
							</button>
						)}
					</div>

					<div className="mt-8">
						<h2 className="border-b border-border-300/15 pb-1 text-sm font-semibold">By Project</h2>
						{groups.map((group) => {
							const shown = group.sessions.slice(0, PER_PROJECT_LIMIT);
							const remaining = group.sessions.length - shown.length;
							return (
								<div
									key={group.project}
									className="mt-4"
								>
									<h3 className="text-sm font-medium text-text-500">
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
												isActive={activeIds.has(sess.id)}
											/>
										))}
									</ul>
									{remaining > 0 && (
										<Link
											to="/project/$id"
											params={{id: group.project}}
											className="mt-1 block px-2 text-xs text-accent-100 hover:underline"
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
	isActive,
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
	isActive?: boolean;
}) {
	return (
		<li>
			<Link
				to="/session/$id"
				params={{id: session.id}}
				className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-bg-200/50"
			>
				<div
					className="flex items-center gap-1.5 truncate"
					style={{fontSize: '14px', fontWeight: 430}}
				>
					{isActive && (
						<span
							className="inline-block h-2 w-2 shrink-0 rounded-full bg-success-000"
							title="Active"
						/>
					)}
					<span className="truncate">{session.title}</span>
				</div>
				<div className="mt-0.5 flex items-center gap-2 text-xs text-text-500">
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
							<span className="rounded bg-bg-200 px-1.5 py-0.5 font-mono text-[10px]">
								{session.gitBranch}
							</span>
						</>
					)}
				</div>
				{session.summary && session.summary !== session.title && (
					<div className="mt-0.5 truncate text-xs text-text-500 italic">{session.summary}</div>
				)}
			</Link>
		</li>
	);
}
