import {createFileRoute} from '@tanstack/react-router';
import {readFileSync} from 'node:fs';
import {getDb} from '../../lib/db';
import {sessions} from '../../lib/db/schema';
import {eq} from 'drizzle-orm';

export const Route = createFileRoute('/api/raw')({
	server: {
		handlers: {
			GET: async ({request}: {request: Request}) => {
				const url = new URL(request.url);
				const sessionId = url.searchParams.get('sessionId');
				if (!sessionId || !/^[a-z0-9-]+$/.test(sessionId)) {
					return new Response('Missing or invalid sessionId', {status: 400});
				}

				const {index} = getDb();
				const row = index.select().from(sessions).where(eq(sessions.id, sessionId)).get();
				if (!row) {
					return new Response('Session not found', {status: 404});
				}

				try {
					const content = readFileSync(row.filePath, 'utf-8');
					return new Response(content, {
						headers: {
							'Content-Type': 'application/jsonl',
							'Content-Disposition': `attachment; filename="${sessionId}.jsonl"`,
						},
					});
				} catch {
					return new Response('File not found', {status: 404});
				}
			},
		},
	},
});
