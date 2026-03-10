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

function SessionsPage() {
	const groups = Route.useLoaderData();

	const allSessions = groups
		.flatMap((g) => g.sessions)
		.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
		.slice(0, 50);

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
						{groups.map((group) => (
							<div
								key={group.project}
								className="mt-4"
							>
								<h3 className="text-sm font-medium text-muted-foreground">{group.projectName}</h3>
								<ul className="mt-1 space-y-1">
									{group.sessions.map((sess) => (
										<SessionItem
											key={sess.id}
											session={sess}
										/>
									))}
								</ul>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	);
}

function SessionItem({session}: {session: {id: string; title: string; mtime: string; projectName: string}}) {
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
				<div
					className="mt-0.5"
					style={{fontSize: '12px', color: 'rgb(115, 114, 108)'}}
				>
					{session.projectName} &middot; {formatDate(session.mtime)}
				</div>
			</Link>
		</li>
	);
}
