import { createFileRoute } from "@tanstack/react-router";
import { rejectCrossSite } from "../../lib/same-origin-guard";

export const Route = createFileRoute("/api/notifications/$id")({
  server: {
    handlers: {
      DELETE: async ({ params, request }: { params: { id: string }; request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { dismissNotification } = await import("../../lib/notifications-store");
        dismissNotification(params.id);
        return Response.json({ ok: true });
      },
    },
  },
});
