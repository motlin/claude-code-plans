import {createFileRoute} from '@tanstack/react-router';
import {getDb} from '../../lib/db';
import {getSessionProjectPath} from '../../lib/db/queries';
import {spawnClaude, killProcess} from '../../lib/cli-runner';
import {broadcast} from '../../lib/watcher';

export const Route = createFileRoute('/api/chat')({
	server: {
		handlers: {
			POST: async ({request}: {request: Request}) => {
				const body = (await request.json()) as {
					sessionId?: string;
					prompt?: string;
					action?: string;
					processId?: string;
				};

				if (body.action === 'cancel' && body.processId) {
					const killed = killProcess(body.processId);
					return Response.json({ok: killed});
				}

				const {sessionId, prompt} = body;
				if (!sessionId || !prompt) {
					return Response.json({error: 'sessionId and prompt are required'}, {status: 400});
				}

				const {index} = getDb();
				const projectPath = getSessionProjectPath(index, sessionId);
				if (!projectPath) {
					return Response.json({error: 'Could not determine project directory for session'}, {status: 404});
				}

				const {stream, processId} = spawnClaude({sessionId, prompt, projectDir: projectPath});

				// After the stream ends, broadcast so the new forked session appears in the UI
				const [passthrough, monitor] = stream.tee();
				(async () => {
					const reader = monitor.getReader();
					try {
						while (true) {
							const {done} = await reader.read();
							if (done) break;
						}
					} finally {
						reader.releaseLock();
						// Small delay to let JSONL flush to disk
						setTimeout(() => broadcast(), 1000);
					}
				})();

				return new Response(passthrough, {
					headers: {
						'Content-Type': 'application/x-ndjson',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
						'X-Process-Id': processId,
					},
				});
			},
		},
	},
});
