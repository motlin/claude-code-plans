import {createFileRoute} from '@tanstack/react-router';
import {MemoryDetailResponse} from '../../lib/api/memories';

export const Route = createFileRoute('/api/projects/$id/memories/$filename')({
	server: {
		handlers: {
			GET: async ({params, request}: {params: {id: string; filename: string}; request: Request}) => {
				const {homedir} = await import('node:os');
				const {join} = await import('node:path');
				const {stat} = await import('node:fs/promises');
				const {readMemory, decodeProjectDir} = await import('../../lib/memory');

				const projectsDir = join(homedir(), '.claude', 'projects');
				const filePath = join(projectsDir, params.id, 'memory', params.filename);

				let mtime: Date | null = null;
				try {
					const fileStat = await stat(filePath);
					mtime = fileStat.mtime;
				} catch {
					// missing file — fall through to readMemory which returns null
				}

				if (mtime) {
					const ifModifiedSince = request.headers.get('If-Modified-Since');
					if (ifModifiedSince) {
						const since = new Date(ifModifiedSince).getTime();
						const mtimeFloor = Math.floor(mtime.getTime() / 1000) * 1000;
						if (!Number.isNaN(since) && since >= mtimeFloor) {
							return new Response(null, {
								status: 304,
								headers: {
									'Cache-Control': 'private, max-age=0, must-revalidate',
									'Last-Modified': mtime.toUTCString(),
								},
							});
						}
					}
				}

				const content = await readMemory(projectsDir, params.id, params.filename);
				if (content === null) {
					return Response.json(MemoryDetailResponse.parse(null), {
						headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
					});
				}

				const projectName = decodeProjectDir(params.id);
				const headers: Record<string, string> = {
					'Cache-Control': 'private, max-age=0, must-revalidate',
				};
				if (mtime) {
					headers['Last-Modified'] = mtime.toUTCString();
				}

				return Response.json(
					MemoryDetailResponse.parse({
						markdown: content,
						mtime: mtime ? mtime.toISOString() : null,
						projectName,
					}),
					{headers},
				);
			},
		},
	},
});
