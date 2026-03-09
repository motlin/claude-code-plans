import {createFileRoute} from '@tanstack/react-router';
import {addClient, removeClient} from '../../lib/watcher';

export const Route = createFileRoute('/api/events')({
	server: {
		handlers: {
			GET: async () => {
				const encoder = new TextEncoder();
				const stream = new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode(':\n\n'));
						addClient(controller);

						const keepalive = setInterval(() => {
							try {
								controller.enqueue(encoder.encode(':\n\n'));
							} catch {
								clearInterval(keepalive);
								removeClient(controller);
							}
						}, 30000);
					},
					cancel(controller) {
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
