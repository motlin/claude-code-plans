import {createFileRoute} from '@tanstack/react-router';
import {MemoryListResponse} from '../../lib/api/memories';

export const Route = createFileRoute('/api/projects/$id/memories')({
	server: {
		handlers: {
			GET: async ({params}: {params: {id: string}}) => {
				const {getDb} = await import('../../lib/db');
				const {getProjectDetailFromDb, getMemoriesForProject} = await import('../../lib/db/queries');

				const {index} = getDb();
				const detail = getProjectDetailFromDb(index, params.id);
				if (!detail) {
					return Response.json(MemoryListResponse.parse(null), {
						headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
					});
				}

				const rows = getMemoriesForProject(index, params.id);
				const memories = rows.map((row) => ({
					filename: row.filename,
					title: row.title,
					mtime: new Date(row.mtimeMs).toISOString(),
					project: params.id,
				}));

				return Response.json(
					MemoryListResponse.parse({
						project: {id: detail.id, name: detail.name, projectPath: detail.projectPath},
						memories,
					}),
					{headers: {'Cache-Control': 'private, max-age=0, must-revalidate'}},
				);
			},
		},
	},
});
