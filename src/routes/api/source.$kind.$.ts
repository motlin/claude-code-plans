import {createFileRoute} from '@tanstack/react-router';
import {SourceFileResponse} from '../../lib/api/source';

export const Route = createFileRoute('/api/source/$kind/$')({
	server: {
		handlers: {
			GET: async ({params, request}: {params: {kind: string; _splat?: string}; request: Request}) => {
				const {homedir} = await import('node:os');
				const {join} = await import('node:path');
				const {buildSourceConfig, isValidSourceKind, readSourceFile} = await import('../../lib/source-view');

				const claudeHome = join(homedir(), '.claude');
				const {kind} = params;
				const relativePath = params._splat ?? '';

				if (!isValidSourceKind(kind)) {
					return Response.json(SourceFileResponse.parse(null), {
						headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
					});
				}

				const config = buildSourceConfig(kind, claudeHome);
				if (!config) {
					return Response.json(SourceFileResponse.parse(null), {
						headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
					});
				}

				const file = await readSourceFile(kind, config, relativePath);
				if (!file) {
					return Response.json(SourceFileResponse.parse(null), {
						headers: {'Cache-Control': 'private, max-age=0, must-revalidate'},
					});
				}

				const ifModifiedSince = request.headers.get('If-Modified-Since');
				if (ifModifiedSince) {
					const since = new Date(ifModifiedSince).getTime();
					const mtimeFloor = Math.floor(file.mtime.getTime() / 1000) * 1000;
					if (!Number.isNaN(since) && since >= mtimeFloor) {
						return new Response(null, {
							status: 304,
							headers: {
								'Cache-Control': 'private, max-age=0, must-revalidate',
								'Last-Modified': file.mtime.toUTCString(),
							},
						});
					}
				}

				return Response.json(
					SourceFileResponse.parse({
						language: file.language,
						content: file.content,
						relativePath: file.relativePath,
						absolutePath: file.absolutePath,
					}),
					{
						headers: {
							'Cache-Control': 'private, max-age=0, must-revalidate',
							'Last-Modified': file.mtime.toUTCString(),
						},
					},
				);
			},
		},
	},
});
