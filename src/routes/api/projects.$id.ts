import {createFileRoute} from '@tanstack/react-router';
import {ProjectDetailResponse} from '../../lib/api/projects';

export const Route = createFileRoute('/api/projects/$id')({
	server: {
		handlers: {
			GET: async ({params}: {params: {id: string}}) => {
				const {getDb} = await import('../../lib/db');
				const {getProjectDetailFromDb} = await import('../../lib/db/queries');

				const {index} = getDb();
				const detail = getProjectDetailFromDb(index, params.id);

				if (!detail) {
					return Response.json(ProjectDetailResponse.parse(null), {
						headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
					});
				}

				return Response.json(
					ProjectDetailResponse.parse({
						id: detail.id,
						name: detail.name,
						projectPath: detail.projectPath,
						subagentCount: detail.subagentCount,
					}),
					{
						headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
					},
				);
			},
		},
	},
});
