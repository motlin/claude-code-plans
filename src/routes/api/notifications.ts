import { createFileRoute } from "@tanstack/react-router";
import { NotificationsResponse } from "../../lib/api/notifications";

export const Route = createFileRoute("/api/notifications")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { getNotifications, getNotificationsForProject } =
          await import("../../lib/notifications-store");
        const url = new URL(request.url);
        const projectId = url.searchParams.get("projectId");
        const notifications = projectId
          ? getNotificationsForProject(projectId)
          : getNotifications();
        return Response.json(NotificationsResponse.parse({ notifications }), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
      DELETE: async () => {
        const { clearAllNotifications } = await import("../../lib/notifications-store");
        clearAllNotifications();
        return Response.json(
          { ok: true },
          { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
        );
      },
    },
  },
});
