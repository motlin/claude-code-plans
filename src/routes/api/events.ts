import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { addClient, removeClient } from "../../lib/watcher";
import { DOMAIN_EVENTS } from "../../lib/hook-events";
import { getLiveSubagentNodes } from "../../lib/live-subagent-store";

export const Route = createFileRoute("/api/events")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const encoder = new TextEncoder();
        let keepalive: ReturnType<typeof setInterval> | null = null;
        let ctrl: ReadableStreamDefaultController | null = null;

        const stream = new ReadableStream({
          start(controller) {
            ctrl = controller;
            controller.enqueue(encoder.encode(":\n\n"));
            controller.enqueue(
              encoder.encode(
                `event: ${DOMAIN_EVENTS.SUBAGENTS_SNAPSHOT}\ndata: ${JSON.stringify({ subagents: getLiveSubagentNodes() })}\n\n`,
              ),
            );
            addClient(controller);

            keepalive = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(":\n\n"));
              } catch {
                clearInterval(keepalive!);
                keepalive = null;
                removeClient(controller);
              }
            }, 30000);
          },
          cancel() {
            if (keepalive) {
              clearInterval(keepalive);
              keepalive = null;
            }
            if (ctrl) {
              removeClient(ctrl);
              ctrl = null;
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    }),
  },
});
