import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/notifications/$id")({
  server: {
    handlers: {
      DELETE: async ({ params }: { params: { id: string } }) => {
        const { dismissNotification } = await import("../../lib/notifications-store");
        dismissNotification(params.id);
        return Response.json({ ok: true });
      },
    },
  },
});
