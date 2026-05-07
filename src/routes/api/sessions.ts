import {createFileRoute} from '@tanstack/react-router';
import {SessionListResponse} from '../../lib/api/sessions';

export const Route = createFileRoute('/api/sessions')({
	server: {
		handlers: {
			GET: async () => {
				const {getDb} = await import('../../lib/db');
				const {listSessionsFromDb, getStarredSessionIds} = await import('../../lib/db/queries');

				const {index} = getDb();
				const groups = listSessionsFromDb(index);
				const starredIds = getStarredSessionIds(index);

				const serialized = groups.map((g) => ({
					project: g.project,
					projectName: g.projectName,
					sessions: g.sessions.map((s) => {
						const item: {
							id: string;
							title: string;
							summary?: string;
							mtime: string;
							created: string;
							project: string;
							projectName: string;
							messageCount: number;
							gitBranch?: string;
							starred: boolean;
						} = {
							id: s.id,
							title: s.title,
							mtime: s.mtime.toISOString(),
							created: s.created.toISOString(),
							project: s.project,
							projectName: s.projectName,
							messageCount: s.messageCount,
							starred: starredIds.has(s.id),
						};
						if (s.summary !== undefined) item.summary = s.summary;
						if (s.gitBranch !== undefined) item.gitBranch = s.gitBranch;
						return item;
					}),
				}));

				return Response.json(SessionListResponse.parse(serialized), {
					headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
				});
			},
		},
	},
});
