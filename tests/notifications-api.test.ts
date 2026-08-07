import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vite-plus/test";
import {
  markNotificationsReadInCache,
  type Notification,
  type NotificationsData,
} from "../src/lib/api/notifications";

function makeNotification(id: string, unread: boolean): Notification {
  return {
    id,
    sessionId: "session-100",
    projectId: "project-100",
    projectName: "Project 100",
    message: `Message ${id}`,
    notificationType: "agent_completed",
    createdAt: 1_000,
    createdAtIso: "2000-01-01T00:00:00.000Z",
    unread,
  };
}

describe("markNotificationsReadInCache", () => {
  it("marks global and project notifications read without removing them", () => {
    const queryClient = new QueryClient();
    const unreadNotification = makeNotification("notification-100", true);
    const readNotification = makeNotification("notification-200", false);
    queryClient.setQueryData<NotificationsData>(["notifications"], {
      notifications: [unreadNotification, readNotification],
    });
    queryClient.setQueryData<NotificationsData>(["notifications", "project-100"], {
      notifications: [unreadNotification],
    });

    markNotificationsReadInCache(queryClient);

    expect(queryClient.getQueryData<NotificationsData>(["notifications"])).toStrictEqual({
      notifications: [{ ...unreadNotification, unread: false }, readNotification],
    });
    expect(
      queryClient.getQueryData<NotificationsData>(["notifications", "project-100"]),
    ).toStrictEqual({
      notifications: [{ ...unreadNotification, unread: false }],
    });
  });
});
