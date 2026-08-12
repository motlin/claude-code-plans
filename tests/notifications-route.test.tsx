// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { hookStatusQueryOptions } from "../src/lib/api/hooks";
import { notificationsQueryOptions } from "../src/lib/api/notifications";
import { HOOK_EVENT_NAMES } from "../src/lib/hook-config";
import { Route as NotificationsRoute } from "../src/routes/notifications";

afterEach(() => {
  cleanup();
});

const ORIGIN_SENTENCE =
  "Claude Code posts one here through its Notification hook, when a session is waiting on you or has finished a turn.";
const LIFETIME_SENTENCE =
  "Notifications are held in this server’s memory only: each one expires after 24 hours, and restarting the server clears them all.";
const MISSING_HOOK_SENTENCE =
  "That hook is not installed in Claude Code’s settings, so no notification can reach this page.";

async function renderEmptyNotifications(missingEvents: string[]) {
  const NotificationsPage = NotificationsRoute.options.component;
  if (!NotificationsPage) throw new Error("Expected the notifications route component");

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(notificationsQueryOptions().queryKey, { notifications: [] });
  queryClient.setQueryData(hookStatusQueryOptions.queryKey, {
    installed: missingEvents.length === 0,
    partial: missingEvents.length > 0 && missingEvents.length < HOOK_EVENT_NAMES.length,
    installedCount: HOOK_EVENT_NAMES.length - missingEvents.length,
    totalCount: HOOK_EVENT_NAMES.length,
    settingsPath: "/Users/test/.claude/settings.json",
    missingEvents,
  });

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        {createElement(NotificationsPage)}
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/notifications"] }),
  });
  await router.load();

  render(<RouterProvider router={router} />);
}

function emptyStateSentences(): string[] {
  const region = screen.getByRole("region", { name: "Why there are no notifications" });
  return [...region.querySelectorAll("p")].map((paragraph) =>
    (paragraph.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
}

describe("notifications route empty state", () => {
  it("explains that the missing Notification hook is why nothing can arrive", async () => {
    await renderEmptyNotifications([...HOOK_EVENT_NAMES]);

    expect({
      sentences: emptyStateSentences(),
      setupHref: screen.getByRole("link", { name: "Install hooks" }).getAttribute("href"),
    }).toStrictEqual({
      sentences: [ORIGIN_SENTENCE, `${MISSING_HOOK_SENTENCE} Install hooks`, LIFETIME_SENTENCE],
      setupHref: "/setup",
    });
  });

  it("flags the missing Notification hook even when other hooks are installed", async () => {
    await renderEmptyNotifications(["Notification"]);

    expect(emptyStateSentences()).toStrictEqual([
      ORIGIN_SENTENCE,
      `${MISSING_HOOK_SENTENCE} Install hooks`,
      LIFETIME_SENTENCE,
    ]);
  });

  it("drops the setup prompt once the Notification hook is installed", async () => {
    await renderEmptyNotifications([]);

    expect({
      sentences: emptyStateSentences(),
      setupLink: screen.queryByRole("link", { name: "Install hooks" }),
    }).toStrictEqual({
      sentences: [ORIGIN_SENTENCE, LIFETIME_SENTENCE],
      setupLink: null,
    });
  });
});
