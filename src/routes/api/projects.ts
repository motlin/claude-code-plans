import {createFileRoute} from '@tanstack/react-router';
import {ProjectListResponse} from '../../lib/api/projects';

export const Route = createFileRoute('/api/projects')({
	server: {
		handlers: {
			GET: async () => {
				const {homedir} = await import('node:os');
				const {join} = await import('node:path');
				const {getDb} = await import('../../lib/db');
				const {listProjectsFromDb, getPlanProjectMappings, getTaskCountsForProject} = await import(
					'../../lib/db/queries'
				);
				const {scanActiveSessions} = await import('../../lib/active-sessions');
				const {readdir} = await import('node:fs/promises');

				const projectsDir = join(homedir(), '.claude', 'projects');
				const {index} = getDb();
				const projects = listProjectsFromDb(index);

				const activeSessions = await scanActiveSessions();
				const activeByProject = new Map<string, number>();
				for (const a of activeSessions) {
					activeByProject.set(a.projectDir, (activeByProject.get(a.projectDir) ?? 0) + 1);
				}

				const allPlanLinks = getPlanProjectMappings(index);
				const planCountByProject = new Map<string, Set<string>>();
				for (const link of allPlanLinks) {
					let set = planCountByProject.get(link.projectId);
					if (!set) {
						set = new Set();
						planCountByProject.set(link.projectId, set);
					}
					set.add(link.planFilename);
				}

				const enriched = await Promise.all(
					projects.map(async (p) => {
						let memoryCount = 0;
						try {
							const memDir = join(projectsDir, p.id, 'memory');
							const files = await readdir(memDir);
							memoryCount = files.filter((f) => f.endsWith('.md')).length;
						} catch {
							// no memory dir
						}

						const taskCounts = getTaskCountsForProject(index, p.name);

						return {
							id: p.id,
							name: p.name,
							projectPath: p.projectPath,
							sessionCount: p.sessionCount,
							memoryCount,
							planCount: planCountByProject.get(p.id)?.size ?? 0,
							taskCount: taskCounts.pending + taskCounts.inProgress,
							activeCount: activeByProject.get(p.id) ?? 0,
							lastActivity: new Date(p.lastActivity).toISOString(),
						};
					}),
				);

				return Response.json(ProjectListResponse.parse(enriched), {
					headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
				});
			},
		},
	},
});
