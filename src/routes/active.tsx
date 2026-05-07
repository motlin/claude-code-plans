import {createFileRoute, Link} from '@tanstack/react-router';
import {useSuspenseQuery} from '@tanstack/react-query';
import type {z} from 'zod';
import {ActiveSessionListResponse} from '../lib/api/sessions';
import {activeSessionsQueryOptions} from '../queries/active';
import {useClaudeEvents} from '../hooks/use-claude-events';
import {useSettings} from '../components/settings-provider';

type ActiveSession = z.infer<typeof ActiveSessionListResponse>[number];

export const Route = createFileRoute('/active')({
	component: ActivePage,
	loader: ({context: {queryClient}}) => queryClient.ensureQueryData(activeSessionsQueryOptions()),
	head: () => ({
		meta: [{title: 'Active Sessions'}],
	}),
});

function formatRelativeTime(lastModified: number): string {
	const diffMs = Date.now() - lastModified;
	const seconds = Math.floor(diffMs / 1000);
	if (seconds < 60) return `modified ${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	return `modified ${minutes}m ago`;
}

function ActivePage() {
	const {settings} = useSettings();
	const activeTimeoutMs = settings.activeTimeoutSec * 1000;
	const {data: loaderSessions} = useSuspenseQuery(activeSessionsQueryOptions(activeTimeoutMs));
	const {activeSessions} = useClaudeEvents();

	// Merge: loader data provides full info (projectName, projectDir),
	// context provides real-time push updates for lastActivity timestamps.
	const sessions: ActiveSession[] = loaderSessions.map((s) => {
		const pushed = activeSessions.get(s.sessionId);
		if (pushed) {
			return {...s, lastModified: pushed.lastActivity};
		}
		return s;
	});

	return (
		<div>
			<div className="flex items-center gap-3">
				<h1 className="text-lg font-semibold">Active Sessions</h1>
				<span className="text-sm text-text-500">{sessions.length} sessions</span>
				<span className="text-xs text-text-500">(live updates via SSE)</span>
			</div>

			{sessions.length === 0 ? (
				<p className="mt-8 text-center text-text-500">No active Claude Code sessions</p>
			) : (
				<div className="mt-4 space-y-1">
					{sessions.map((session) => (
						<Link
							key={session.sessionId}
							to="/session/$id"
							params={{id: session.sessionId}}
							className="block rounded-md border border-border-300/15 p-3 no-underline transition-colors hover:bg-bg-200/50"
						>
							<div className="flex items-center gap-2">
								<span className="relative flex h-2.5 w-2.5">
									<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
									<span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
								</span>
								<span className="truncate text-sm font-medium text-text-000">
									{session.projectName}
								</span>
								<span className="ml-auto text-xs text-text-500">
									{formatRelativeTime(session.lastModified)}
								</span>
							</div>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
