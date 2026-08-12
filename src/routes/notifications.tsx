import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CheckCircle2, Info, MessageCircleQuestion, X } from "lucide-react";
import {
  notificationsQueryOptions,
  useClearNotifications,
  useDismissNotification,
  type Notification,
} from "../lib/api/notifications";
import { hookStatusQueryOptions } from "../lib/api/hooks";
import { sessionTitlesQueryOptions } from "../lib/api/sessions";
import { formatRelativeTimeFromIso } from "../lib/relative-time";
import { ListPageHeader } from "../components/list-page-header";

export const Route = createFileRoute("/notifications")({
  component: NotificationsPage,
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(notificationsQueryOptions()),
  head: () => ({
    meta: [{ title: "Notifications" }],
  }),
});

function TypeIcon({ notificationType }: { notificationType: string }) {
  const className = "size-4 shrink-0";
  if (notificationType === "agent_needs_input") {
    return <MessageCircleQuestion className={`${className} text-accent-100`} />;
  }
  if (notificationType === "agent_completed") {
    return <CheckCircle2 className={`${className} text-green-500`} />;
  }
  return <Info className={`${className} text-text-500`} />;
}

/**
 * Why the list is empty, rather than a bare "nothing here". Entries only ever
 * come from Claude Code's `Notification` hook and are never rebuilt by
 * rescanning `~/.claude`, so an install with that hook missing shows an empty
 * page forever — say so and link to the installer instead of looking broken.
 */
function EmptyNotifications() {
  const { data: hookStatus } = useQuery(hookStatusQueryOptions);
  const notificationHookMissing = hookStatus?.missingEvents.includes("Notification") === true;

  return (
    <section
      aria-label="Why there are no notifications"
      className="mt-8 space-y-3 text-sm text-text-500"
    >
      <p>
        Claude Code posts one here through its Notification hook, when a session is waiting on you
        or has finished a turn.
      </p>
      {notificationHookMissing ? (
        <p>
          That hook is not installed in Claude Code&rsquo;s settings, so no notification can reach
          this page.{" "}
          <Link to="/setup" className="text-accent-100 hover:underline">
            Install hooks
          </Link>
        </p>
      ) : null}
      <p>
        Notifications are held in this server&rsquo;s memory only: each one expires after 24 hours,
        and restarting the server clears them all.
      </p>
    </section>
  );
}

function NotificationsPage() {
  const { data } = useSuspenseQuery(notificationsQueryOptions());
  const notifications = data.notifications;

  const sessionIds = useMemo(() => notifications.map((n) => n.sessionId), [notifications]);
  const { data: titlesData } = useQuery(sessionTitlesQueryOptions(sessionIds));
  const titles = titlesData?.titles ?? {};

  const dismiss = useDismissNotification();
  const clearAll = useClearNotifications();

  return (
    <div>
      <ListPageHeader
        title="Notifications"
        count={notifications.length}
        itemLabel="notification"
        actions={
          notifications.length > 0 ? (
            <button
              type="button"
              onClick={() => clearAll.mutate()}
              className="text-xs text-text-500 hover:text-text-000"
            >
              Clear all
            </button>
          ) : undefined
        }
      />

      {notifications.length === 0 ? (
        <EmptyNotifications />
      ) : (
        <ul className="mt-4 space-y-1">
          {notifications.map((notification: Notification) => {
            const sessionTitle = titles[notification.sessionId] ?? notification.sessionId;
            const heading = notification.title ?? notification.message;

            return (
              <li key={notification.id} className="group relative">
                <Link
                  to="/session/$id"
                  params={{ id: notification.sessionId }}
                  className="block rounded-md border border-border-300/15 p-3 pr-10 no-underline transition-colors hover:bg-bg-200/50"
                >
                  <div className="flex items-center gap-2">
                    <TypeIcon notificationType={notification.notificationType} />
                    <span className="truncate text-sm font-medium text-text-000">
                      {notification.projectName}
                    </span>
                    <span className="ml-auto text-xs text-text-500">
                      {formatRelativeTimeFromIso(notification.createdAtIso)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-text-400">{heading}</div>
                  <div className="mt-1 truncate text-xs text-text-500">{sessionTitle}</div>
                </Link>
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => dismiss.mutate(notification.id)}
                  className="absolute right-2 top-2 rounded p-1 text-text-500 opacity-0 transition-opacity hover:bg-bg-300/50 hover:text-text-000 group-hover:opacity-100"
                >
                  <X className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
