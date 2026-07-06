import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

import type { NotificationEntryPayload } from "../lib/hook-events";
import { useSubscribeNotifications } from "../hooks/use-claude-events";
import { useSettings, type Settings } from "./settings-provider";

/**
 * Pure decision for whether a freshly added notification should raise a native
 * OS notification. Extracted from the effect so it can be unit-tested without a
 * DOM. The whole point of desktop notifications is to alert the user when they
 * are *not* looking at the browser, so we only pop when the tab is backgrounded
 * (`hidden`), the user has opted in (`settings.desktopNotifications`), and the
 * OS has granted permission. `type` is the freeform notification discriminator;
 * every kind (including unknown ones) is allowed through — classification is a
 * presentation-layer concern, so it never gates the popup.
 */
export function shouldNotify(
  settings: Settings,
  hidden: boolean,
  permission: NotificationPermission,
  _type: string,
): boolean {
  return settings.desktopNotifications && hidden && permission === "granted";
}

/**
 * Side-effect-only component (renders nothing). Subscribes to the
 * `subscribeNotifications` channel exposed by `ClaudeEventsProvider` and, for
 * each freshly added notification, raises a native OS notification when
 * `shouldNotify` is satisfied. Clicking the notification focuses the tab and
 * deep-links to the originating session.
 */
export function DesktopNotificationBridge(): null {
  const { settings } = useSettings();
  const subscribeNotifications = useSubscribeNotifications();
  const router = useRouter();

  useEffect(() => {
    if (typeof Notification === "undefined") return;

    return subscribeNotifications((payload: NotificationEntryPayload) => {
      if (typeof document === "undefined") return;
      if (
        !shouldNotify(settings, document.hidden, Notification.permission, payload.notificationType)
      )
        return;

      const notif = new Notification(payload.title ?? "Claude Code", {
        body: payload.message,
        tag: payload.id,
      });
      notif.onclick = () => {
        window.focus();
        void router.navigate({
          to: "/session/$id",
          params: { id: payload.sessionId },
        });
        notif.close();
      };
    });
  }, [subscribeNotifications, settings, router]);

  return null;
}
