import { createFileRoute } from "@tanstack/react-router";
import { NotificationsResponse } from "../../lib/api/notifications";
import { hmrPersist } from "../../lib/hmr-persist";
import { rejectCrossSite } from "../../lib/same-origin-guard";

const readNotificationIds = hmrPersist("readNotificationIds", () => new Set<string>());

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
        if (!projectId) {
          const notificationIds = new Set(notifications.map((notification) => notification.id));
          for (const id of readNotificationIds) {
            if (!notificationIds.has(id)) readNotificationIds.delete(id);
          }
        }
        const response = {
          notifications: notifications.map((notification) => ({
            ...notification,
            unread: !readNotificationIds.has(notification.id),
          })),
        };
        return Response.json(NotificationsResponse.parse(response), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
      PATCH: async ({ request }: { request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { getNotifications } = await import("../../lib/notifications-store");
        readNotificationIds.clear();
        for (const notification of getNotifications()) {
          readNotificationIds.add(notification.id);
        }
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
        readNotificationIds.clear();
        return Response.json(
          { ok: true },
          { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
        );
      },
    },
  },
});
