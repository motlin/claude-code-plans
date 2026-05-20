import {createFileRoute} from '@tanstack/react-router';
import {PlanListResponse} from '../../lib/api/plans';

export const Route = createFileRoute('/api/plans')({
	server: {
		handlers: {
			GET: async () => {
				const {getDb} = await import('../../lib/db');
				const {getPlanProjectMappings, listPlansFromDb} = await import('../../lib/db/queries');

				const {index} = getDb();
				const plans = listPlansFromDb(index);

				const mappings = getPlanProjectMappings(index);
				const planProjects = new Map<string, Map<string, string>>();
				for (const m of mappings) {
					let projects = planProjects.get(m.planFilename);
					if (!projects) {
						projects = new Map();
						planProjects.set(m.planFilename, projects);
					}
					if (!projects.has(m.projectId)) {
						projects.set(m.projectId, m.projectName);
					}
				}

				const serialized = plans.map((p) => {
					const refs = planProjects.get(p.filename);
					return {
						filename: p.filename,
						title: p.title,
						mtime: new Date(p.mtimeMs).toISOString(),
						projects: refs
							? [...refs.entries()].map(([projectId, projectName]) => ({projectId, projectName}))
							: [],
					};
				});

				return Response.json(PlanListResponse.parse(serialized), {
					headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
				});
			},
		},
	},
});
