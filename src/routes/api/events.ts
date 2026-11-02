import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {addClient, removeClient} from "../../lib/watcher";
import {onServerShutdown} from "../../lib/server-shutdown";
import {connectEvents} from "../../lib/sse-connect-events";
import {SSE_HIGH_WATER_MARK_BYTES} from "../../lib/sse-broadcast";

export const Route = createFileRoute("/api/events")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: ({request}: {request: Request}) =>
					{
						if (new URL(request.url).searchParams.has("snapshot"))
						{
							return Response.json(
								connectEvents(),
								{
									headers:
									{
										"Cache-Control": "no-cache",
									},
								},
							);
						}
						const encoder = new TextEncoder();
						let keepalive: ReturnType<typeof setInterval> | null = null;
						let ctrl: ReadableStreamDefaultController | null = null;
						let unregisterShutdown: (() => void) | null = null;

						const release = () =>
						{
							if (keepalive)
							{
								clearInterval(keepalive);
								keepalive = null;
							}
							if (ctrl)
							{
								removeClient(ctrl);
								ctrl = null;
							}
							unregisterShutdown?.();
							unregisterShutdown = null;
						};

						const stream = new ReadableStream<Uint8Array>(
							{
								start(controller)
								{
									ctrl = controller;
									controller.enqueue(encoder.encode(":\n\n"));
									for (const event of connectEvents())
									{
										controller.enqueue(
											encoder.encode(`event: ${event.type}\ndata: ${event.data}\n\n`),
										);
									}
									addClient(controller);

									keepalive = setInterval(() =>
									{
										try
										{
											controller.enqueue(encoder.encode(":\n\n"));
										}
										catch
										{
											release();
										}
									}, 30000);

									// An open stream would otherwise hold the HTTP server (and its
									// keepalive timer the event loop) open through shutdown.
									unregisterShutdown = onServerShutdown(() =>
									{
										release();
										try
										{
											controller.close();
										}
										catch
										{
											// already closed
										}
									});
								},
								cancel: release,
							},
							// Byte-sized so desiredSize tracks the unsent backlog that
							// broadcastTyped uses to drop stalled clients.
							new ByteLengthQueuingStrategy(
								{
									highWaterMark: SSE_HIGH_WATER_MARK_BYTES,
								},
							),
						);

						return new Response(
							stream,
							{
								headers:
								{
									"Content-Type": "text/event-stream",
									"Cache-Control": "no-cache",
									// The stream owns its connection: once it ends (on shutdown) the
									// socket closes instead of idling out the server's keep-alive
									// timeout, which would stall a graceful stop by ~5s.
									Connection: "close",
								},
							},
						);
					},
				},
			),
		},
	},
);
