import {createFileRoute} from '@tanstack/react-router';
import {addClient, removeClient} from '../../lib/watcher';

export const Route = createFileRoute('/api/events')({
	server: {
		handlers: {
			GET: async () => {
				const encoder = new TextEncoder();
				let keepalive: ReturnType<typeof setInterval> | null = null;

				const stream = new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode(':\n\n'));
						addClient(controller);

						keepalive = setInterval(() => {
							try {
								controller.enqueue(encoder.encode(':\n\n'));
							} catch {
								clearInterval(keepalive!);
								keepalive = null;
								removeClient(controller);
							}
						}, 30000);
					},
					cancel(controller) {
						if (keepalive) {
							clearInterval(keepalive);
							keepalive = null;
						}
						removeClient(controller as unknown as ReadableStreamDefaultController);
					},
				});

				return new Response(stream, {
					headers: {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
					},
				});
			},
		},
	},
});
