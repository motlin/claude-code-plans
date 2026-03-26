import {createFileRoute} from '@tanstack/react-router';
import {HookEventEnvelope, SSE_EVENTS} from '../../lib/hook-events';
import {broadcastTyped} from '../../lib/watcher';
import {markSessionActive, markSessionEnded, touchSession} from '../../lib/active-session-store';

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

				const event = result.data;

				switch (event.hook_event_name) {
					case 'SessionStart': {
						const meta: {cwd: string; model?: string} = {
							cwd: event.cwd ?? '',
						};
						if (event.model !== undefined) {
							meta.model = event.model;
						}
						markSessionActive(event.session_id, meta);
						broadcastTyped(SSE_EVENTS.SESSION_START, {
							sessionId: event.session_id,
							cwd: event.cwd ?? '',
							model: event.model ?? '',
						});
						break;
					}

					case 'SessionEnd':
						markSessionEnded(event.session_id);
						broadcastTyped(SSE_EVENTS.SESSION_END, {
							sessionId: event.session_id,
						});
						break;

					case 'Stop':
						touchSession(event.session_id);
						broadcastTyped(SSE_EVENTS.SESSION_UPDATE, {
							sessionId: event.session_id,
						});
						break;

					case 'PostToolUse': {
						const filePath = (event.tool_input as Record<string, unknown> | undefined)?.['file_path'];
						if (typeof filePath === 'string' && filePath.includes('/tasks/')) {
							broadcastTyped(SSE_EVENTS.TASK_UPDATED, {
								sessionId: event.session_id,
								filePath,
							});
						}
						touchSession(event.session_id);
						break;
					}

					case 'TaskCompleted':
						broadcastTyped(SSE_EVENTS.TASK_COMPLETED, {
							sessionId: event.session_id,
							taskId: event.task_id ?? '',
							subject: event.task_subject ?? '',
						});
						touchSession(event.session_id);
						break;

					case 'WorktreeCreate':
						broadcastTyped(SSE_EVENTS.WORKTREE_CREATED, {
							sessionId: event.session_id,
							name: event.name ?? '',
						});
						break;
				}

				return Response.json({ok: true});
			},
		},
	},
});
