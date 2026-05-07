import {createFileRoute} from '@tanstack/react-router';
import {ProjectSessionListResponse} from '../../lib/api/projects';

export const Route = createFileRoute('/api/projects/$id/sessions')({
	server: {
		handlers: {
			GET: async ({params}: {params: {id: string}}) => {
				const {getDb} = await import('../../lib/db');
				const {listSessionsForProjectFromDb, getSubagentsForProject} = await import('../../lib/db/queries');

				const {index} = getDb();
				const sessions = listSessionsForProjectFromDb(index, params.id);
				const allSubagents = getSubagentsForProject(index, params.id);

				const subagentBySession = new Map<string, number>();
				for (const a of allSubagents) {
					subagentBySession.set(a.sessionId, (subagentBySession.get(a.sessionId) ?? 0) + 1);
				}

				const serialized = sessions.map((s) => {
					const item: {
						id: string;
						title: string;
						summary?: string;
						mtime: string;
						created: string;
						messageCount: number;
						gitBranch?: string;
						subagentCount: number;
					} = {
						id: s.id,
						title: s.title,
						mtime: s.mtime.toISOString(),
						created: s.created.toISOString(),
						messageCount: s.messageCount,
						subagentCount: subagentBySession.get(s.id) ?? 0,
					};
					if (s.summary !== undefined) item.summary = s.summary;
					if (s.gitBranch !== undefined) item.gitBranch = s.gitBranch;
					return item;
				});

				return Response.json(ProjectSessionListResponse.parse(serialized), {
					headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
				});
			},
		},
	},
});
