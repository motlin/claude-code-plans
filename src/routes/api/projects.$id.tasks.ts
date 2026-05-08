import {createFileRoute} from '@tanstack/react-router';
import {ProjectTasksResponse} from '../../lib/api/projects';

export const Route = createFileRoute('/api/projects/$id/tasks')({
	server: {
		handlers: {
			GET: async ({params}: {params: {id: string}}) => {
				const {getDb} = await import('../../lib/db');
				const {getProjectDetailFromDb, getTasksForProject, getTaskCountsForProject} = await import(
					'../../lib/db/queries'
				);

				const {index} = getDb();
				const detail = getProjectDetailFromDb(index, params.id);

				if (!detail) {
					return Response.json(
						ProjectTasksResponse.parse({
							todos: [],
							todoCounts: {total: 0, pending: 0, inProgress: 0, completed: 0},
						}),
						{headers: {'Cache-Control': 'private, max-age=0, must-revalidate'}},
					);
				}

				const todos = getTasksForProject(index, detail.name);
				const todoCounts = getTaskCountsForProject(index, detail.name);

				return Response.json(ProjectTasksResponse.parse({todos, todoCounts}), {
					headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
				});
			},
		},
	},
});
