import {createFileRoute, Link} from '@tanstack/react-router';
import {useEffect, useState} from 'react';
import {getActiveSessions} from '../lib/server-fns';

type ActiveSession = Awaited<ReturnType<typeof getActiveSessions>>[number];

export const Route = createFileRoute('/active')({
	component: ActivePage,
	loader: () => getActiveSessions(),
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

function decodeProjectName(encoded: string): string {
	const parts = encoded.replace(/^-/, '/').replace(/-/g, '/').split('/');
	return parts[parts.length - 1]!;
}

function ActivePage() {
	const initialSessions = Route.useLoaderData();
	const [sessions, setSessions] = useState<ActiveSession[]>(initialSessions);

	useEffect(() => {
		const interval = setInterval(async () => {
			const data = await getActiveSessions();
			setSessions(data);
		}, 5000);
		return () => clearInterval(interval);
	}, []);

	return (
		<div>
			<div className="flex items-center gap-3">
				<h1 className="text-lg font-semibold">Active Sessions</h1>
				<span className="text-sm text-text-500">{sessions.length} sessions</span>
				<span className="text-xs text-text-500">(auto-refresh 5s)</span>
			</div>

			{sessions.length === 0 ? (
				<p className="mt-8 text-center text-text-500">No active Claude Code sessions</p>
			) : (
				<div className="mt-4 space-y-1">
					{sessions.map((session) => (
						<div
							key={session.sessionId}
							className="rounded-md border border-border-300/15 p-3 hover:bg-bg-200/50 transition-colors"
						>
							<div className="flex items-center gap-2">
								<span className="relative flex h-2.5 w-2.5">
									<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
									<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
								</span>
								<span className="text-sm text-text-000 font-medium truncate">
									{decodeProjectName(session.projectDir)}
								</span>
								<span className="text-xs text-text-500 ml-auto">
									{formatRelativeTime(session.lastModified)}
								</span>
							</div>
							<div className="mt-1.5 flex items-center gap-2">
								<Link
									to="/session/$id"
									params={{id: session.sessionId}}
									className="text-xs font-mono text-accent-100 hover:underline"
								>
									{session.sessionId.slice(0, 8)}...
								</Link>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
