import {createFileRoute} from '@tanstack/react-router';
import {PlanDetailResponse} from '../../lib/api/plans';

export const Route = createFileRoute('/api/plans/$filename')({
	server: {
		handlers: {
			GET: async ({params, request}: {params: {filename: string}; request: Request}) => {
				const {homedir} = await import('node:os');
				const {join} = await import('node:path');
				const {readPlan, getPlanMtime} = await import('../../lib/plans');
				const {extractTitleFromContent} = await import('../../lib/markdown-utils');

				const plansDir = join(homedir(), '.claude', 'plans');
				const filename = params.filename;

				const mtime = await getPlanMtime(plansDir, filename);
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

				const markdown = await readPlan(plansDir, filename);
				if (markdown == null) {
					return new Response('Not Found', {status: 404});
				}

				const title = extractTitleFromContent(markdown, filename);

				const headers: Record<string, string> = {
					'Cache-Control': 'private, max-age=0, must-revalidate',
				};
				if (mtime) {
					headers['Last-Modified'] = mtime.toUTCString();
				}

				return Response.json(
					PlanDetailResponse.parse({
						markdown,
						mtime: mtime ? mtime.toISOString() : null,
						title,
					}),
					{headers},
				);
			},
			PUT: async ({params, request}: {params: {filename: string}; request: Request}) => {
				const {homedir} = await import('node:os');
				const {join} = await import('node:path');
				const {writePlan, getPlanMtime} = await import('../../lib/plans');
				const {extractTitleFromContent} = await import('../../lib/markdown-utils');

				const plansDir = join(homedir(), '.claude', 'plans');
				const markdown = await request.text();
				const ok = await writePlan(plansDir, params.filename, markdown);
				if (!ok) {
					return new Response('Not Found', {status: 404});
				}

				const mtime = await getPlanMtime(plansDir, params.filename);
				const title = extractTitleFromContent(markdown, params.filename);

				return Response.json(
					{
						title,
						mtime: mtime ? mtime.toISOString() : null,
					},
					{headers: {'Cache-Control': 'private, max-age=0, must-revalidate'}},
				);
			},
		},
	},
});
