import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { rejectCrossSite } from "../../lib/same-origin-guard";

export const Route = createFileRoute("/api/notifications/$id")({
  server: {
    handlers: withMethodNotAllowed({
      DELETE: async ({ params, request }: { params: { id: string }; request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { dismissNotification } = await import("../../lib/notifications-store");
        dismissNotification(params.id);
        return Response.json({ ok: true });
      },
    }),
  },
});
