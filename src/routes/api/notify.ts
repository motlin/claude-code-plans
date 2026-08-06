import { createFileRoute } from "@tanstack/react-router";
import { rejectCrossSite } from "../../lib/same-origin-guard";
import { broadcast } from "../../lib/watcher";

export const Route = createFileRoute("/api/notify")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        broadcast();
        return Response.json({ ok: true });
      },
    },
  },
});
