import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { rejectCrossSite } from "../../lib/same-origin-guard";
import { broadcast } from "../../lib/watcher";

export const Route = createFileRoute("/api/notify")({
  server: {
    handlers: withMethodNotAllowed({
      POST: async ({ request }: { request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        broadcast();
        return Response.json({ ok: true });
      },
    }),
  },
});
