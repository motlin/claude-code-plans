import { createFileRoute } from "@tanstack/react-router";
import { clearAllNotifications, getNotifications } from "../../lib/notifications-store";

export const Route = createFileRoute("/api/notifications")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(
          { notifications: getNotifications() },
          { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
        );
      },
      DELETE: async () => {
        clearAllNotifications();
        return Response.json(
          { ok: true },
          { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
        );
      },
    },
  },
});
