import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { NotificationsResponse } from "../../lib/api/notifications";
import { rejectCrossSite } from "../../lib/same-origin-guard";

export const Route = createFileRoute("/api/notifications")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ request }: { request: Request }) => {
        const { getNotifications, getNotificationsForProject, isNotificationUnread } =
          await import("../../lib/notifications-store");
        const url = new URL(request.url);
        const projectId = url.searchParams.get("projectId");
        const notifications = projectId
          ? getNotificationsForProject(projectId)
          : getNotifications();
        const response = {
          notifications: notifications.map((notification) => ({
            ...notification,
            unread: isNotificationUnread(notification.id),
          })),
        };
        return Response.json(NotificationsResponse.parse(response), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
      PATCH: async ({ request }: { request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { markAllNotificationsRead } = await import("../../lib/notifications-store");
        markAllNotificationsRead();
        return Response.json(
          { ok: true },
          { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
        );
      },
      DELETE: async ({ request }: { request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { clearAllNotifications } = await import("../../lib/notifications-store");
        clearAllNotifications();
        return Response.json(
          { ok: true },
          { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
        );
      },
    }),
  },
});
