// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { Sidebar } from "../src/components/sidebar/Sidebar";
import { navItems } from "../src/components/sidebar/navigation";
import { ToastProvider } from "../src/components/toast";
import { Route as HomeRoute } from "../src/routes/index";

const DEFAULT_APPLICATION_SETTINGS = {
  herdrWritesEnabled: false,
  shellPaneEnabled: true,
  visibleNavSections: ["herdr", "plans", "memories", "customize"],
  ignoredDirs: ["node_modules"],
};

function sectionVisibility() {
  const sidebarLinks = within(screen.getByRole("navigation", { name: "Sidebar" })).getAllByRole(
    "link",
  );
  const homeLinks = within(screen.getByRole("region", { name: "Home sections" })).getAllByRole(
    "link",
  );
  const hasDestination = (links: HTMLElement[], destination: string) =>
    links.some((link) => link.getAttribute("href") === destination);

  return {
    sidebar: {
      herdr: hasDestination(sidebarLinks, "/herdr"),
      tmux: hasDestination(sidebarLinks, "/tmux"),
    },
    home: {
      herdr: hasDestination(homeLinks, "/herdr"),
      tmux: hasDestination(homeLinks, "/tmux"),
    },
  };
}

async function renderNavigation() {
  const Home = HomeRoute.options.component;
  if (!Home) throw new Error("Expected the home route component");

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["application-settings"], DEFAULT_APPLICATION_SETTINGS);
  queryClient.setQueryData(["approvals"], { approvals: [] });
  queryClient.setQueryData(["notifications"], { notifications: [] });
  queryClient.setQueryData(["sessions", "active", 60_000], []);
  queryClient.setQueryData(["local-account"], {
    name: "Ada Lovelace",
    firstName: "Ada",
    initial: "A",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );

  const rootRoute = createRootRoute({
    component: () =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          ToastProvider,
          null,
          createElement(Sidebar, { collapsed: false, onToggle: () => undefined }),
          createElement(Home),
        ),
      ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const view = render(createElement(RouterProvider, { router }));

  return { queryClient, view };
}

describe("home grid", () => {
  it("keeps the sidebar and home grid visibility synchronized", async () => {
    const { queryClient, view } = await renderNavigation();
    try {
      expect(sectionVisibility()).toStrictEqual({
        sidebar: { herdr: true, tmux: false },
        home: { herdr: true, tmux: false },
      });

      act(() => {
        queryClient.setQueryData(["application-settings"], {
          ...DEFAULT_APPLICATION_SETTINGS,
          visibleNavSections: ["herdr", "tmux", "plans", "memories", "customize"],
        });
      });
      await waitFor(() =>
        expect(sectionVisibility()).toStrictEqual({
          sidebar: { herdr: true, tmux: true },
          home: { herdr: true, tmux: true },
        }),
      );

      act(() => {
        queryClient.setQueryData(["application-settings"], {
          ...DEFAULT_APPLICATION_SETTINGS,
          visibleNavSections: ["tmux", "plans", "memories", "customize"],
        });
      });
      await waitFor(() =>
        expect(sectionVisibility()).toStrictEqual({
          sidebar: { herdr: false, tmux: true },
          home: { herdr: false, tmux: true },
        }),
      );
    } finally {
      view.unmount();
      queryClient.clear();
      vi.unstubAllGlobals();
    }
  });

  it("renders the upstream shell: greeting in an 840px column, full-bleed route", async () => {
    const { queryClient, view } = await renderNavigation();
    try {
      const heading = screen.getByRole("heading", { level: 1 });
      const column = heading.closest("header");
      expect({
        fullBleed: HomeRoute.options.staticData?.fullBleed,
        heading: heading.textContent,
        columnClass: column?.className,
        cardsBelowGreeting:
          screen.getByRole("region", { name: "Home sections" }).closest("[data-home-body]") !==
          null,
      }).toStrictEqual({
        fullBleed: true,
        heading: "Welcome back, Ada",
        columnClass: "mx-auto flex w-full max-w-[840px] items-center gap-1.5 pt-3 pr-10 pb-6 pl-8",
        cardsBelowGreeting: true,
      });
    } finally {
      view.unmount();
      queryClient.clear();
      vi.unstubAllGlobals();
    }
  });

  it("gives every card a non-empty description", () => {
    expect(
      navItems
        .filter((card) => card.description.length === 0)
        .map(({ label, to }) => ({ label, to })),
    ).toStrictEqual([]);
  });

  it("uses the Herdr name for the terminal fleet card", () => {
    expect(
      navItems
        .filter((card) => card.to === "/herdr")
        .map(({ label, to, description }) => ({ label, to, description })),
    ).toStrictEqual([
      { label: "Herdr", to: "/herdr", description: "Live terminals managed by Herdr" },
    ]);
  });
});
