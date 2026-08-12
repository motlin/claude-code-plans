// @vitest-environment jsdom

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  SessionProjectGroups,
  SESSION_PROJECT_PREVIEW_LIMIT,
} from "../src/components/session-project-groups";
import { GroupedSessionsResponse } from "../src/lib/api/sessions";

function session(id: string, title: string, project: string, mtime: string) {
  return {
    id,
    title,
    mtime,
    created: mtime,
    project,
    projectName: project,
    messageCount: 4,
    starred: false,
    state: "ended",
    blockedSince: null,
  };
}

const groups = GroupedSessionsResponse.parse([
  {
    project: "gamma",
    projectName: "Gamma",
    sessionCount: 7,
    sessions: [
      session("g1", "Gamma newest", "Gamma", "2026-08-07T10:00:00Z"),
      session("g2", "Gamma older", "Gamma", "2026-08-01T10:00:00Z"),
    ],
  },
  {
    project: "alpha",
    projectName: "Alpha",
    sessionCount: 1,
    sessions: [session("a1", "Alpha only", "Alpha", "2026-08-05T10:00:00Z")],
  },
]);

async function renderGroups(activeIds: Set<string> = new Set(), rendered: typeof groups = groups) {
  const rootRoute = createRootRoute({
    component: () => <SessionProjectGroups groups={rendered} activeIds={activeIds} />,
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/session/$id",
    component: () => null,
  });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/project/$id",
    component: () => null,
  });
  const projectSessionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/project/$id/sessions",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([sessionRoute, projectRoute, projectSessionsRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

afterEach(cleanup);

describe("SessionProjectGroups", () => {
  it("renders project headings in the order the server returned them", async () => {
    await renderGroups();

    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent ?? "");
    expect(headings.map((text) => text.replace(/\d+.*$/, "").trim())).toEqual(["Gamma", "Alpha"]);
  });

  it("links to the project session list when a group is truncated", async () => {
    await renderGroups();

    const more = screen.getByRole("link", { name: /5 more sessions/ });
    expect(more.getAttribute("href")).toBe("/project/gamma/sessions");
    expect(screen.queryByRole("link", { name: /more sessions/ })).toBe(more);
  });

  it("marks live sessions with an active indicator", async () => {
    await renderGroups(new Set(["g1"]));

    expect(screen.getAllByTitle("Active").length).toBe(1);
  });

  it("holds back projects past the preview limit until asked", async () => {
    const many = GroupedSessionsResponse.parse(
      Array.from({ length: SESSION_PROJECT_PREVIEW_LIMIT + 3 }, (_, index) => ({
        project: `p${index}`,
        projectName: `Project ${index}`,
        sessionCount: 1,
        sessions: [
          session(`s${index}`, `Session ${index}`, `Project ${index}`, "2026-08-07T10:00:00Z"),
        ],
      })),
    );

    await renderGroups(new Set(), many);

    expect(screen.getAllByRole("heading").length).toBe(SESSION_PROJECT_PREVIEW_LIMIT);
    expect(screen.queryByRole("heading", { name: /Project 12/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /3 more projects/ }));

    expect(screen.getAllByRole("heading").length).toBe(SESSION_PROJECT_PREVIEW_LIMIT + 3);
    expect(screen.queryByRole("button", { name: /more projects/ })).toBeNull();
  });
});
