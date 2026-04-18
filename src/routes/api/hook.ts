import {createFileRoute} from '@tanstack/react-router';
import {HookEventEnvelope} from '../../lib/hook-events';
import {broadcastTyped} from '../../lib/watcher';
import {dispatchHookEvent} from '../../lib/hook-dispatcher';
import {getActiveSessionEntry, markSessionActive, markSessionEnded, touchSession} from '../../lib/active-session-store';
import {getDb} from '../../lib/db';

export const Route = createFileRoute('/api/hook')({
	server: {
		handlers: {
			POST: async ({request}) => {
				let body: unknown;
				try {
					body = await request.json();
				} catch {
					return Response.json({error: 'Invalid JSON'}, {status: 400});
				}

				const result = HookEventEnvelope.safeParse(body);
				if (!result.success) {
					return Response.json({error: 'Invalid hook event', details: result.error}, {status: 400});
				}

				const {index} = getDb();

				dispatchHookEvent({
					event: result.data,
					db: index,
					store: {
						markSessionActive,
						markSessionEnded,
						touchSession,
						getActiveSessionEntry,
					},
					broadcast: broadcastTyped,
				});

				return Response.json({ok: true});
			},
		},
	},
});
