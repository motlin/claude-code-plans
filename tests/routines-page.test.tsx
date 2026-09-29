// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { routinesQueryOptions, type Routine } from "../src/lib/api/routines";
import { Route as RoutinesRoute } from "../src/routes/routines";

const HOUR = 60 * 60 * 1000;
const now = Date.now();

function routine(overrides: Partial<Routine>): Routine {
  return {
    toolUseId: "toolu_x",
    recordUuid: "uuid-x",
    kind: "cron",
    routineId: "abc12345",
    name: null,
    schedule: "*/5 * * * *",
    humanSchedule: "Every 5 minutes",
    delaySeconds: null,
    runOnceAt: null,
    recurring: true,
    durable: false,
    prompt: "Poll the PR",
    createdAt: now - HOUR,
    deletedAt: null,
    sessionId: "session-a",
    projectId: "-Users-alice-projects-app",
    sessionTitle: "Fix the build",
    status: "active",
    nextRunAt: now + HOUR,
    ...overrides,
  };
}

const ROUTINES: Routine[] = [
  routine({ toolUseId: "poll", recordUuid: "uuid-poll", prompt: "Poll the PR\nThen report." }),
  routine({
    toolUseId: "wake",
    recordUuid: "uuid-wake",
    kind: "wakeup",
    routineId: null,
    schedule: null,
    humanSchedule: null,
    delaySeconds: 600,
    runOnceAt: now + 10 * 60 * 1000,
    recurring: false,
    prompt: "Check the deploy",
    nextRunAt: now + 10 * 60 * 1000,
  }),
  routine({
    toolUseId: "cloud",
    recordUuid: "uuid-cloud",
    kind: "cloud",
    routineId: "trig_1",
    name: "Upload reminder",
    schedule: null,
    humanSchedule: null,
    runOnceAt: now + 2 * HOUR,
    recurring: false,
    durable: true,
    prompt: "Remind me to upload",
    sessionId: "session-b",
    sessionTitle: "Playdate build",
    nextRunAt: now + 2 * HOUR,
  }),
  routine({
    toolUseId: "done",
    recordUuid: "uuid-done",
    prompt: "Old sweep",
    status: "completed",
    deletedAt: now - HOUR,
    nextRunAt: null,
  }),
];

afterEach(() => {
  cleanup();
});

async function renderRoutinesPage(routines: Routine[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(routinesQueryOptions.queryKey, routines);

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const { component } = RoutinesRoute.options;
  const routinesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/routines",
    ...(component ? { component } : {}),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([routinesRoute]),
    history: createMemoryHistory({ initialEntries: ["/routines"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: "Routines" });
  return router;
}

function rows() {
  return within(screen.getByRole("list", { name: "Routines" }))
    .getAllByRole("listitem")
    .map((row) => ({
      title: row.querySelector("[data-routine-title]")?.textContent,
      href: row.querySelector("a[data-primary]")?.getAttribute("href"),
    }));
}

describe("routines route", () => {
  it("lists active routines by next run, linking to the tool call, and counts hidden ones", async () => {
    await renderRoutinesPage(ROUTINES);

    expect({
      rows: rows(),
      hidden: screen.getByText("1 completed routine hidden").tagName,
      newRoutine: screen.queryByRole("button", { name: "New routine" }),
      templates: screen.queryByRole("tab", { name: "Templates" }),
    }).toStrictEqual({
      rows: [
        { title: "Check the deploy", href: "/session/session-a/source/uuid-wake" },
        { title: "Poll the PR", href: "/session/session-a/source/uuid-poll" },
        { title: "Upload reminder", href: "/session/session-b/source/uuid-cloud" },
      ],
      hidden: "SPAN",
      newRoutine: null,
      templates: null,
    });
  });

  it("marks the schedule type, cloud routines and status on each row", async () => {
    await renderRoutinesPage(ROUTINES);
    const list = screen.getByRole("list", { name: "Routines" });

    expect(
      within(list)
        .getAllByRole("listitem")
        .map((row) => row.querySelector("[data-routine-meta]")?.textContent),
    ).toStrictEqual([
      expect.stringMatching(/^One-time · Wakeup · Next run /),
      expect.stringMatching(/^Every 5 minutes · Next run /),
      expect.stringMatching(/^One-time · Cloud · Next run /),
    ]);
  });

  it("includes completed routines from the Sort menu", async () => {
    await renderRoutinesPage(ROUTINES);

    fireEvent.click(screen.getByRole("button", { name: "Sort routines" }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: /Include completed/ }));

    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(screen.queryByText("1 completed routine hidden")).toBeNull();
  });

  it("filters by schedule and searches routines", async () => {
    await renderRoutinesPage(ROUTINES);

    fireEvent.click(screen.getByRole("button", { name: "Filter routines" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Recurring" }));
    await waitFor(() => expect(rows().map((row) => row.title)).toStrictEqual(["Poll the PR"]));

    fireEvent.click(screen.getByRole("menuitemradio", { name: "One-time" }));
    fireEvent.click(screen.getByRole("button", { name: "Search routines" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search routines" }), {
      target: { value: "playdate" },
    });

    await waitFor(() => expect(rows().map((row) => row.title)).toStrictEqual(["Upload reminder"]));
  });

  it("shows only the hidden count when every routine has completed", async () => {
    await renderRoutinesPage([ROUTINES[3] as Routine]);

    expect({
      list: screen.queryByRole("list", { name: "Routines" }),
      hidden: screen.getByText("1 completed routine hidden").textContent,
    }).toStrictEqual({ list: null, hidden: "1 completed routine hidden" });
  });
});
