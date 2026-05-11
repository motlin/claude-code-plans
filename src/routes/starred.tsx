import {createFileRoute, Link} from '@tanstack/react-router';
import {useSuspenseQuery, useQueryClient} from '@tanstack/react-query';
import {useMemo} from 'react';
import {z} from 'zod';
import {apiFetch} from '../lib/api/client';
import {sessionsQueryOptions} from '../lib/api/sessions';

const StarredMutationResponse = z.object({starred: z.boolean()});

export const Route = createFileRoute('/starred')({
	component: StarredPage,
	loader: ({context: {queryClient}}) => queryClient.ensureQueryData(sessionsQueryOptions),
	head: () => ({
		meta: [{title: 'Starred Sessions'}],
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

function StarredPage() {
	const queryClient = useQueryClient();
	const {data: groups} = useSuspenseQuery(sessionsQueryOptions);
	const sessions = useMemo(
		() =>
			groups
				.flatMap((group) => group.sessions)
				.filter((session) => session.starred)
				.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime()),
		[groups],
	);

	async function handleUnstar(sessionId: string) {
		await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/starred`, StarredMutationResponse, {
			method: 'PUT',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({starred: false}),
		});
		void queryClient.invalidateQueries({queryKey: ['sessions']});
	}

	return (
		<div>
			<h1 className="text-lg font-semibold">Starred Sessions</h1>

			{sessions.length === 0 ? (
				<p className="mt-4 text-sm text-text-500">
					No starred sessions yet. Star a session from its detail page.
				</p>
			) : (
				<ul className="mt-4 space-y-1">
					{sessions.map((session) => (
						<li
							key={session.id}
							className="group relative"
						>
							<Link
								to="/session/$id"
								params={{id: session.id}}
								className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-bg-200/50"
							>
								<div
									className="truncate pr-8"
									style={{fontSize: '14px', fontWeight: 430}}
								>
									{session.title}
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
								</div>
								{session.summary && session.summary !== session.title && (
									<div className="mt-0.5 truncate text-xs text-text-500 italic">
										{session.summary}
									</div>
								)}
							</Link>
							<button
								type="button"
								onClick={(e) => {
									e.preventDefault();
									handleUnstar(session.id);
								}}
								className="absolute right-2 top-3 cursor-pointer text-warning-000 opacity-0 transition-opacity group-hover:opacity-100"
								title="Unstar"
							>
								<svg
									viewBox="0 0 24 24"
									className="h-4 w-4"
									fill="currentColor"
									stroke="currentColor"
									strokeWidth="2"
								>
									<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
								</svg>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
