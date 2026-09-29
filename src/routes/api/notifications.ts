import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { NotificationsResponse } from "../../lib/api/notifications";
import { rejectCrossSite } from "../../lib/same-origin-guard";
import {
  invalidSessionStatusResponse,
  parseSessionStatusParam,
} from "../../lib/api/session-status-param";

export const Route = createFileRoute("/api/notifications")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ request }: { request: Request }) => {
        const { getNotifications, getNotificationsForProject, isNotificationUnread } =
          await import("../../lib/notifications-store");
        const { getDb } = await import("../../lib/db");
        const { getArchivedSessionIds } = await import("../../lib/db/queries");
        const url = new URL(request.url);
        const status = parseSessionStatusParam(url);
        if (status === null) return invalidSessionStatusResponse();
        const projectId = url.searchParams.get("projectId");
        const notifications = projectId
          ? getNotificationsForProject(projectId)
          : getNotifications();
        const archivedIds = getArchivedSessionIds(getDb().index);
        const visible = notifications.filter((notification) => {
          const archived = archivedIds.has(notification.sessionId);
          return status === "all" || (status === "archived") === archived;
        });
        const response = {
          notifications: visible.map((notification) => ({
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
