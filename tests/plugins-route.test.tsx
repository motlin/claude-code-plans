// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { PluginInfoData } from "../src/lib/api/plugins";
import { pluginsQueryOptions, userCommandsQueryOptions } from "../src/lib/api/plugins";
import { PluginCard, PluginsPage } from "../src/components/plugins-page";
import { Route as PluginsRoute } from "../src/routes/plugins";
import { Route as RootRoute } from "../src/routes/__root";

const scrollIntoView = vi.fn();

const plugin: PluginInfoData = {
  id: "caveman@caveman",
  name: "Caveman",
  version: "1.0.0",
  versionKind: "release",
  description: "Build software with sticks and stones.",
  author: "Caveman",
  marketplace: "claude-plugins-official",
  installPath: "/plugins/caveman",
  agents: [
    {
      filename: "caveman.md",
      name: "Caveman agent",
      description: "An agent",
      type: "agent",
      frontmatter: {},
    },
  ],
  commands: [],
  skills: [],
};

async function renderWithRouter(
  element: React.ReactNode,
  initialEntry = "/plugins",
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const rootRoute = createRootRoute({
    component: () => <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  scrollIntoView.mockReset();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("blank-screen prevention on /plugins", () => {
  it("renders the page header and a skeleton while the plugin queries are pending", async () => {
    // A fetch that never resolves keeps both queries pending forever.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    try {
      await renderWithRouter(<PluginsPage />);

      expect({
        heading: screen.getByRole("heading", { name: "Plugins" }).textContent,
        skeleton: screen.getByTestId("plugins-skeleton") !== null,
      }).toStrictEqual({ heading: "Plugins", skeleton: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("route loaders never block rendering on pending queries", () => {
    // With `ssr: false` nothing paints until every matched loader resolves, so
    // the root and plugins loaders must warm caches without awaiting them.
    const never = new Promise<never>(() => {});
    const queryClient = {
      prefetchQuery: vi.fn(() => never),
      prefetchInfiniteQuery: vi.fn(() => never),
      ensureQueryData: vi.fn(() => never),
      ensureInfiniteQueryData: vi.fn(() => never),
    };

    const context = { queryClient } as never;
    const loaderResults = {
      root: (RootRoute.options.loader as (args: { context: unknown }) => unknown)({ context }),
      plugins: (PluginsRoute.options.loader as (args: { context: unknown }) => unknown)({
        context,
      }),
    };

    expect({
      ...loaderResults,
      awaitedQueries:
        queryClient.ensureQueryData.mock.calls.length +
        queryClient.ensureInfiniteQueryData.mock.calls.length,
    }).toStrictEqual({ root: undefined, plugins: undefined, awaitedQueries: 0 });
  });
});

describe("plugin cards", () => {
  it("toggles from every part of the accessible card-header button", async () => {
    await renderWithRouter(<PluginCard plugin={plugin} isHashTarget={false} />);
    const header = screen.getByRole("button", { name: /Caveman/ });

    expect({
      ariaControls: header.getAttribute("aria-controls"),
      ariaExpanded: header.getAttribute("aria-expanded"),
      tagName: header.tagName,
      type: header.getAttribute("type"),
    }).toStrictEqual({
      ariaControls: "caveman@caveman-contents",
      ariaExpanded: "false",
      tagName: "BUTTON",
      type: "button",
    });

    fireEvent.click(screen.getByText("Caveman"));
    expect(header.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByText("1 agent"));
    expect(header.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(screen.getByText("Build software with sticks and stones."));
    expect(header.getAttribute("aria-expanded")).toBe("true");

    header.focus();
    fireEvent.click(header, { detail: 0 });
    expect({
      activeElement: document.activeElement,
      ariaExpanded: header.getAttribute("aria-expanded"),
    }).toStrictEqual({ activeElement: header, ariaExpanded: "false" });
  });

  it("opens and scrolls to a plugin named by the initial URL hash", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(pluginsQueryOptions.queryKey, [
      { ...plugin, agents: [] },
    ] satisfies PluginInfoData[]);
    queryClient.setQueryData(userCommandsQueryOptions.queryKey, []);

    await renderWithRouter(<PluginsPage />, "/plugins#caveman@caveman", queryClient);

    await waitFor(() => {
      expect(scrollIntoView.mock.calls).toStrictEqual([[{ block: "center" }]]);
    });

    const card = document.getElementById("caveman@caveman");
    expect({
      cardId: card?.id,
      marketplaceExpanded: screen
        .getByRole("button", { name: /Claude Plugins Official/ })
        .getAttribute("aria-expanded"),
      panelText: document.getElementById("caveman@caveman-contents")?.textContent,
      pluginExpanded: screen.getByRole("button", { name: /Caveman/ }).getAttribute("aria-expanded"),
    }).toStrictEqual({
      cardId: "caveman@caveman",
      marketplaceExpanded: "true",
      panelText: "ContentsFilesNo agents, commands, or skills found.",
      pluginExpanded: "true",
    });
  });
});
