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
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  customizeMcpServersQueryOptions,
  customizeSkillsQueryOptions,
  type McpServerSummary,
  type SkillSummary,
} from "../src/lib/api/customize";
import { pluginsQueryOptions } from "../src/lib/api/plugins";
import { Route as CustomizeLayoutRoute } from "../src/routes/customize";
import { Route as CustomizeConnectorsRoute } from "../src/routes/customize.connectors";
import { Route as CustomizePluginsRoute } from "../src/routes/customize.plugins";
import { Route as CustomizeSkillsRoute } from "../src/routes/customize.skills";

afterEach(() => {
  cleanup();
});

const SKILLS: SkillSummary[] = [
  {
    id: "personal:deploy-checklist",
    name: "deploy-checklist",
    description: "Walk the release checklist before shipping.",
    source: "personal",
    sourceLabel: "Personal",
    dir: "/Users/test/.claude/skills/deploy-checklist",
    mtime: Date.parse("2026-09-15T12:00:00Z"),
    enabled: true,
  },
];

const MCP_SERVERS: McpServerSummary[] = [
  {
    id: "user:github",
    name: "github",
    scope: "user",
    transport: "stdio",
    urlOrCommand: "npx github-mcp",
    enabled: true,
    envKeys: [],
    headerKeys: [],
  },
];

function component<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`Expected the ${name} route component`);
  return value;
}

async function renderCustomize(initialEntry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(customizeSkillsQueryOptions.queryKey, SKILLS);
  queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, MCP_SERVERS);
  queryClient.setQueryData(pluginsQueryOptions.queryKey, []);

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const layoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "customize",
    component: component(CustomizeLayoutRoute.options.component, "customize"),
    validateSearch: CustomizeLayoutRoute.options.validateSearch,
  });
  const skillsRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: "skills",
    component: component(CustomizeSkillsRoute.options.component, "skills"),
  });
  const connectorsRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: "connectors",
    component: component(CustomizeConnectorsRoute.options.component, "connectors"),
  });
  const pluginsRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: "plugins",
    component: component(CustomizePluginsRoute.options.component, "plugins"),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      layoutRoute.addChildren([skillsRoute, connectorsRoute, pluginsRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: "Customize" });
  return router;
}

function sectionTabs() {
  const tablist = screen.getByRole("tablist", { name: "Customize sections" });
  return within(tablist)
    .getAllByRole("tab")
    .map((tab) => ({
      name: tab.textContent,
      selected: tab.getAttribute("aria-selected"),
    }));
}

describe("customize shell", () => {
  it("marks the active section tab and switches sections through the URL", async () => {
    const router = await renderCustomize("/customize/skills");

    expect(sectionTabs()).toStrictEqual([
      { name: "Skills", selected: "true" },
      { name: "Connectors", selected: "false" },
      { name: "Plugins", selected: "false" },
    ]);
    expect(screen.getByRole("radiogroup", { name: "Skills" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Connectors" }));
    });

    expect({
      pathname: router.state.location.pathname,
      tabs: sectionTabs(),
      segmented: screen.queryByRole("radiogroup", { name: "Connectors" }),
      placeholder: screen.getByRole("searchbox").getAttribute("placeholder"),
    }).toStrictEqual({
      pathname: "/customize/connectors",
      tabs: [
        { name: "Skills", selected: "false" },
        { name: "Connectors", selected: "true" },
        { name: "Plugins", selected: "false" },
      ],
      segmented: null,
      placeholder: "Search connectors",
    });
  });

  it("switches between Yours and Discover through the view search param", async () => {
    const router = await renderCustomize("/customize/skills");
    const group = screen.getByRole("radiogroup", { name: "Skills" });

    await act(async () => {
      fireEvent.click(within(group).getByRole("radio", { name: "Discover" }));
    });

    expect({
      search: router.state.location.searchStr,
      checked: within(group)
        .getAllByRole("radio")
        .map((radio) => [radio.textContent, radio.getAttribute("aria-checked")]),
    }).toStrictEqual({
      search: "?view=discover",
      checked: [
        ["Yours", "false"],
        ["Discover", "true"],
      ],
    });
  });

  it("round-trips the search term through ?q=", async () => {
    const router = await renderCustomize("/customize/skills?q=deploy");
    const input = screen.getByRole("searchbox", { name: "Search skills and plugins" });

    expect(input).toHaveProperty("value", "deploy");

    await act(async () => {
      fireEvent.change(input, { target: { value: "review" } });
    });
    expect(router.state.location.searchStr).toBe("?q=review");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    });
    expect({
      search: router.state.location.searchStr,
      value: screen.getByRole("searchbox").getAttribute("value") ?? "",
    }).toStrictEqual({ search: "", value: "" });
  });

  it("disables Filter and Sort while a search term is set", async () => {
    await renderCustomize("/customize/skills?q=deploy");
    const searching = [
      screen.getByRole("button", { name: "Filter" }).hasAttribute("disabled"),
      screen.getByRole("button", { name: "Sort by Last edited" }).hasAttribute("disabled"),
    ];
    cleanup();

    await renderCustomize("/customize/skills");
    const idle = [
      screen.getByRole("button", { name: "Filter" }).hasAttribute("disabled"),
      screen.getByRole("button", { name: "Sort by Last edited" }).hasAttribute("disabled"),
    ];

    expect({ searching, idle }).toStrictEqual({
      searching: [true, true],
      idle: [false, false],
    });
  });

  it("shows the no-match state when the search finds no skills", async () => {
    await renderCustomize("/customize/skills?q=zzz-nothing");
    const empty = screen.getByRole("status");

    expect([...empty.querySelectorAll("h3, p")].map((node) => node.textContent)).toStrictEqual([
      "No skills match your search",
      "Try a different term.",
    ]);
  });

  it("lists skills whose description matches the search term", async () => {
    await renderCustomize("/customize/skills?q=release");

    expect(screen.getAllByTestId("customize-list-row").map((row) => row.textContent)).toStrictEqual(
      ["deploy-checklistfrom Personal·Walk the release checklist before shipping.Sep 15"],
    );
  });
});
