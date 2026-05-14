import {createFileRoute} from '@tanstack/react-router';
import {PlanDetailResponse} from '../../lib/api/plans';

export const Route = createFileRoute('/api/plans/$filename')({
	server: {
		handlers: {
			GET: async ({params, request}: {params: {filename: string}; request: Request}) => {
				const {homedir} = await import('node:os');
				const {join} = await import('node:path');
				const {readPlan, buildPlanNotModifiedResponse} = await import('../../lib/plans');
				const {extractTitleFromContent} = await import('../../lib/markdown-utils');
				const {getDb} = await import('../../lib/db');
				const {getPlanFromDb} = await import('../../lib/db/queries');

				const plansDir = join(homedir(), '.claude', 'plans');
				const filename = params.filename;

				const row = getPlanFromDb(getDb().index, filename);
				const notModified = buildPlanNotModifiedResponse(request.headers.get('If-None-Match'), row);
				if (notModified) return notModified;

				const markdown = await readPlan(plansDir, filename);
				if (markdown == null || row == null) {
					return new Response('Not Found', {status: 404});
				}

				const title = extractTitleFromContent(markdown, filename);

				const headers: Record<string, string> = {
					'Cache-Control': 'private, max-age=0, must-revalidate',
					ETag: `"${row.sha}"`,
				};

				return Response.json(
					PlanDetailResponse.parse({
						markdown,
						sha: row.sha,
						systemFrom: row.systemFrom,
						title,
					}),
					{headers},
				);
			},
			PUT: async ({params, request}: {params: {filename: string}; request: Request}) => {
				const {homedir} = await import('node:os');
				const {join} = await import('node:path');
				const {writePlan} = await import('../../lib/plans');
				const {extractTitleFromContent} = await import('../../lib/markdown-utils');

				const plansDir = join(homedir(), '.claude', 'plans');
				const markdown = await request.text();
				const ok = await writePlan(plansDir, params.filename, markdown);
				if (!ok) {
					return new Response('Not Found', {status: 404});
				}

				const title = extractTitleFromContent(markdown, params.filename);

				return Response.json(
					{
						title,
					},
					{headers: {'Cache-Control': 'private, max-age=0, must-revalidate'}},
				);
			},
		},
	},
});
