// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
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

describe("home page", () => {
  it("leaves top-level navigation to the sidebar: home renders no nav cards", async () => {
    const { queryClient, view } = await renderNavigation();
    try {
      const homeBody = document.querySelector("[data-home-body]");
      if (!(homeBody instanceof HTMLElement)) throw new Error("Expected the home body");
      const sidebarLinks = within(screen.getByRole("navigation", { name: "Sidebar" }))
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"));
      expect({
        sidebarHasHerdr: sidebarLinks.includes("/herdr"),
        homeSectionsRegion: screen.queryByRole("region", { name: "Home sections" }),
        homeLinks: within(homeBody)
          .queryAllByRole("link")
          .map((link) => link.getAttribute("href")),
      }).toStrictEqual({ sidebarHasHerdr: true, homeSectionsRegion: null, homeLinks: [] });
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
      }).toStrictEqual({
        fullBleed: true,
        heading: "Welcome back, Ada",
        columnClass: "mx-auto flex w-full max-w-[840px] items-center gap-1.5 pt-3 pr-10 pb-6 pl-8",
      });
    } finally {
      view.unmount();
      queryClient.clear();
      vi.unstubAllGlobals();
    }
  });

  it("uses the Herdr name for the terminal fleet nav item", () => {
    expect(
      navItems.filter((item) => item.to === "/herdr").map(({ label, to }) => ({ label, to })),
    ).toStrictEqual([{ label: "Herdr", to: "/herdr" }]);
  });
});
