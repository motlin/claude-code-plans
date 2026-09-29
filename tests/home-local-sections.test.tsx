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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  HomeLocalSections,
  MemoriesUpdatedSection,
  RecentPlansSection,
  type RecentMemory,
} from "../src/components/home/local-sections";
import { SettingsProvider, settingStorageKey } from "../src/components/settings-provider";
import { MemoryListResponse, projectMemoriesQueryOptions } from "../src/lib/api/memories";
import { plansQueryOptions, type PlanListItem } from "../src/lib/api/plans";
import { projectsQueryOptions } from "../src/lib/api/projects";
import { installLocalStorage } from "./fake-storage";

const MINUTE = 60 * 1000;
const NOW = new Date(2026, 8, 29, 12, 0).getTime();
const ago = (minutes: number) => new Date(NOW - minutes * MINUTE).toISOString();

function plan(filename: string, minutesAgo: number, projectName: string | null): PlanListItem {
  return {
    filename,
    title: `Plan ${filename}`,
    mtime: ago(minutesAgo),
    projects: projectName === null ? [] : [{ projectId: `-${projectName}`, projectName }],
  };
}

function memory(filename: string, minutesAgo: number, projectName: string): RecentMemory {
  return {
    filename,
    title: `Memory ${filename}`,
    mtime: ago(minutesAgo),
    project: `-${projectName}`,
    projectName,
  };
}

function sectionRows(name: string) {
  const section = screen.getByRole("region", { name });
  return within(section)
    .getAllByRole("listitem")
    .map((li) => ({
      className: li.className,
      pill: li.querySelector("[data-pill-label]")?.textContent,
      title: li.querySelector("[data-row-title]")?.textContent,
      project: li.querySelector("[data-row-project]")?.textContent ?? null,
      time: li.querySelector("time")?.textContent,
    }));
}

const ROW_CLASS =
  "group flex h-10 items-center gap-2 rounded-lg bg-alpha-1 px-[5px] py-2 hover:bg-alpha-2 focus-within:bg-alpha-2";

beforeEach(() => {
  installLocalStorage();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RecentPlansSection", () => {
  it("renders the three newest plans with the upstream row recipe", () => {
    const onOpen = vi.fn();
    render(
      <RecentPlansSection
        plans={[
          plan("oldest.md", 600, "alpha"),
          plan("newest.md", 5, "alpha"),
          plan("middle.md", 90, null),
          plan("second.md", 30, "beta"),
        ]}
        now={NOW}
        onOpen={onOpen}
      />,
    );

    expect({
      heading: screen.getByRole("heading", { level: 2 }).textContent,
      rows: sectionRows("Recent plans"),
    }).toStrictEqual({
      heading: "Recent plans",
      rows: [
        {
          className: ROW_CLASS,
          pill: "Plan",
          title: "Plan newest.md",
          project: "alpha",
          time: "5m ago",
        },
        {
          className: ROW_CLASS,
          pill: "Plan",
          title: "Plan second.md",
          project: "beta",
          time: "30m ago",
        },
        {
          className: ROW_CLASS,
          pill: "Plan",
          title: "Plan middle.md",
          project: null,
          time: "1h ago",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Open plan Plan second.md" }));
    expect(onOpen.mock.calls).toStrictEqual([["second.md"]]);
  });

  it("renders nothing when there are no plans", () => {
    const { container } = render(<RecentPlansSection plans={[]} now={NOW} onOpen={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("MemoriesUpdatedSection", () => {
  it("renders the three most recently updated memories", () => {
    const onOpen = vi.fn();
    render(
      <MemoriesUpdatedSection
        memories={[
          memory("a.md", 300, "alpha"),
          memory("b.md", 2, "beta"),
          memory("c.md", 45, "alpha"),
          memory("d.md", 20, "gamma"),
        ]}
        now={NOW}
        onOpen={onOpen}
      />,
    );

    expect({
      heading: screen.getByRole("heading", { level: 2 }).textContent,
      rows: sectionRows("Memories updated"),
    }).toStrictEqual({
      heading: "Memories updated",
      rows: [
        {
          className: ROW_CLASS,
          pill: "Memory",
          title: "Memory b.md",
          project: "beta",
          time: "2m ago",
        },
        {
          className: ROW_CLASS,
          pill: "Memory",
          title: "Memory d.md",
          project: "gamma",
          time: "20m ago",
        },
        {
          className: ROW_CLASS,
          pill: "Memory",
          title: "Memory c.md",
          project: "alpha",
          time: "45m ago",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Open memory Memory d.md" }));
    expect(onOpen.mock.calls).toStrictEqual([[{ project: "-gamma", filename: "d.md" }]]);
  });

  it("renders nothing when there are no memories", () => {
    const { container } = render(
      <MemoriesUpdatedSection memories={[]} now={NOW} onOpen={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("HomeLocalSections", () => {
  function project(name: string, memoryCount: number) {
    return {
      id: `-${name}`,
      name,
      projectPath: `/${name}`,
      sessionCount: 1,
      memoryCount,
      planCount: 0,
      taskCount: 0,
      activeCount: 0,
      lastActivity: ago(1),
    };
  }

  async function renderHome(plans: PlanListItem[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(plansQueryOptions().queryKey, plans);
    queryClient.setQueryData(projectsQueryOptions().queryKey, [
      project("alpha", 1),
      project("empty", 0),
    ]);
    const alphaMemories: z.infer<typeof MemoryListResponse> = {
      project: { id: "-alpha", name: "alpha", projectPath: "/alpha" },
      memories: [
        { filename: "notes.md", title: "Memory notes.md", mtime: ago(10), project: "-alpha" },
      ],
    };
    queryClient.setQueryData(projectMemoriesQueryOptions("-alpha").queryKey, alphaMemories);

    const rootRoute = createRootRoute({
      component: () => (
        <QueryClientProvider client={queryClient}>
          <SettingsProvider>
            <Outlet />
          </SettingsProvider>
        </QueryClientProvider>
      ),
    });
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: HomeLocalSections,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await act(() => router.load());
    render(<RouterProvider router={router} />);
    return queryClient;
  }

  it("is hidden by default so home matches claude.ai/code", async () => {
    await renderHome([plan("newest.md", 5, "alpha")]);
    await act(() => Promise.resolve());
    expect(
      screen.queryAllByRole("region").map((region) => region.getAttribute("aria-label")),
    ).toStrictEqual([]);
  });

  it("shows Recent plans and Memories updated when the setting is on", async () => {
    localStorage.setItem(settingStorageKey("homeShowLocalSections"), "true");
    await renderHome([plan("newest.md", 5, "alpha")]);
    await waitFor(() =>
      expect(
        screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
      ).toStrictEqual(["Recent plans", "Memories updated"]),
    );
  });

  it("skips an empty section when the setting is on", async () => {
    localStorage.setItem(settingStorageKey("homeShowLocalSections"), "true");
    await renderHome([]);
    await waitFor(() =>
      expect(
        screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
      ).toStrictEqual(["Memories updated"]),
    );
  });
});
