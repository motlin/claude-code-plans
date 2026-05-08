import {createFileRoute} from '@tanstack/react-router';
import {SessionListResponse} from '../../lib/api/sessions';

export const Route = createFileRoute('/api/sessions')({
	server: {
		handlers: {
			GET: async () => {
				const {getDb} = await import('../../lib/db');
				const {listSessionsFromDb, getStarredSessionIds} = await import('../../lib/db/queries');
				const {toSessionSummaryPayload} = await import('../../lib/session-summary');

				const {index} = getDb();
				const groups = listSessionsFromDb(index);
				const starredIds = getStarredSessionIds(index);

				const serialized = groups.map((g) => ({
					project: g.project,
					projectName: g.projectName,
					sessions: g.sessions.map((s) => toSessionSummaryPayload(s, starredIds.has(s.id))),
				}));

				return Response.json(SessionListResponse.parse(serialized), {
					headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
				});
			},
		},
	},
});
