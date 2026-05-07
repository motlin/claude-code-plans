import {createFileRoute} from '@tanstack/react-router';
import {ProjectSubagentsResponse} from '../../lib/api/projects';

export const Route = createFileRoute('/api/projects/$id/subagents')({
	server: {
		handlers: {
			GET: async ({params}: {params: {id: string}}) => {
				const {getDb} = await import('../../lib/db');
				const {sessions} = await import('../../lib/db/schema');
				const {eq} = await import('drizzle-orm');
				const {readFileSync} = await import('node:fs');
				const {extractSubagents} = await import('../../lib/subagents');

				const {index} = getDb();

				const sessionRows = index
					.select({id: sessions.id, filePath: sessions.filePath})
					.from(sessions)
					.where(eq(sessions.projectId, params.id))
					.all();

				const allAgents = sessionRows.flatMap((row) => {
					try {
						const content = readFileSync(row.filePath, 'utf-8');
						const records = content
							.split('\n')
							.filter((line) => line.trim())
							.map((line) => {
								try {
									return JSON.parse(line) as Record<string, unknown>;
								} catch {
									return null;
								}
							})
							.filter((r): r is Record<string, unknown> => r !== null);
						return extractSubagents(records, params.id);
					} catch {
						return [];
					}
				});

				return Response.json(ProjectSubagentsResponse.parse(allAgents), {
					headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
				});
			},
		},
	},
});
