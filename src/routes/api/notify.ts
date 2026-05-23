import { createFileRoute } from "@tanstack/react-router";
import { broadcast } from "../../lib/watcher";

export const Route = createFileRoute("/api/notify")({
  server: {
    handlers: {
      POST: async () => {
        broadcast();
        return Response.json({ ok: true });
      },
    },
  },
});
