import {createFileRoute} from '@tanstack/react-router';
import {MemoryListResponse} from '../../lib/api/memories';

export const Route = createFileRoute('/api/projects/$id/memories')({
	server: {
		handlers: {
			GET: async ({params}: {params: {id: string}}) => {
				const {homedir} = await import('node:os');
				const {join} = await import('node:path');
				const {readdir, stat} = await import('node:fs/promises');
				const {getDb} = await import('../../lib/db');
				const {getProjectDetailFromDb} = await import('../../lib/db/queries');

				const projectsDir = join(homedir(), '.claude', 'projects');
				const {index} = getDb();
				const detail = getProjectDetailFromDb(index, params.id);
				if (!detail) {
					return Response.json(MemoryListResponse.parse(null), {
						headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
					});
				}

				const memDir = join(projectsDir, params.id, 'memory');
				let mdFiles: string[];
				try {
					const files = await readdir(memDir);
					mdFiles = files.filter((f) => f.endsWith('.md'));
				} catch {
					return Response.json(
						MemoryListResponse.parse({
							project: {id: detail.id, name: detail.name, projectPath: detail.projectPath},
							memories: [],
						}),
						{headers: {'Cache-Control': 'private, max-age=0, must-revalidate'}},
					);
				}

				const settled = await Promise.all(
					mdFiles.map(async (filename) => {
						try {
							const fileStat = await stat(join(memDir, filename));
							return {
								filename,
								title: filename.replace(/\.md$/, ''),
								mtime: fileStat.mtime.toISOString(),
								project: params.id,
							};
						} catch {
							return null;
						}
					}),
				);
				const memories = settled.filter((m): m is NonNullable<typeof m> => m !== null);
				memories.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

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
