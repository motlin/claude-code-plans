// @vitest-environment jsdom

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ContentsViewer } from "../src/components/customize/contents-viewer";
import { PluginDetailHeader, PluginHooks } from "../src/components/customize/plugin-detail";
import { pluginDetailTabs } from "../src/components/customize/plugin-view";
import { commandRows } from "../src/components/customize/skills-view";
import { ToastProvider } from "../src/components/toast";
import type { PluginDetail } from "../src/lib/api/customize";
import { readPluginDetail } from "../src/lib/customize/plugins";
import { listPlugins } from "../src/lib/plugins";
import { redirectLegacyCommand } from "../src/routes/command.$source.$filename";
import { redirectLegacyPluginFile } from "../src/routes/plugin.$id.$type.$";
import { redirectLegacyPlugins } from "../src/routes/plugins";

let claudeDir: string;

function write(path: string, content: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
}

function install(installPath: string) {
  return [
    {
      scope: "user",
      installPath,
      version: "1.2.0",
      installedAt: "2026-09-01T00:00:00.000Z",
      lastUpdated: "2026-09-02T00:00:00.000Z",
    },
  ];
}

beforeEach(() => {
  claudeDir = mkdtempSync(join(tmpdir(), "customize-plugins-"));
  const tools = join(claudeDir, "plugins", "cache", "market", "tools");
  const loose = join(claudeDir, "plugins", "cache", "market", "loose");

  write(join(claudeDir, "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: { "tools@market": install(tools), "loose@market": install(loose) },
  });
  write(join(claudeDir, "settings.json"), { enabledPlugins: { "tools@market": true } });
  write(
    join(claudeDir, "plugins", "marketplaces", "market", ".claude-plugin", "marketplace.json"),
    {
      name: "market",
      owner: { name: "Market" },
      plugins: [
        {
          name: "tools",
          source: "./tools",
          description: "Tooling",
          category: "development",
          tags: ["lint"],
          homepage: "https://tools.example.com",
          author: { name: "Market" },
        },
        { name: "loose", source: "./loose" },
      ],
    },
  );

  write(join(tools, ".claude-plugin", "plugin.json"), {
    name: "tools",
    version: "1.2.0",
    description: "Tooling",
    author: { name: "Ann" },
  });
  write(join(tools, "README.md"), "# Tools\n");
  write(
    join(tools, "skills", "format", "SKILL.md"),
    "---\nname: format\ndescription: Formats code\n---\n",
  );
  write(join(tools, "agents", "reviewer.md"), "---\nname: reviewer\ndescription: Reviews\n---\n");
  write(join(tools, "commands", "ship.md"), "---\ndescription: Ships it\n---\n");
  write(join(tools, "hooks", "hooks.json"), {
    description: "Guards",
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }],
      Stop: [
        {
          hooks: [
            { type: "command", command: "recap.sh" },
            { type: "http", url: "https://hooks.example.com/stop" },
          ],
        },
      ],
    },
  });
  write(join(tools, ".mcp.json"), {
    mcpServers: {
      docs: {
        type: "http",
        url: "https://docs.example.com/mcp",
        headers: { Authorization: "Bearer secret" },
      },
    },
  });

  write(join(loose, ".claude-plugin", "plugin.json"), { name: "loose", version: "0.1.0" });
  write(join(loose, "hooks", "hooks.json"), {
    hooks: { Stop: [{ hooks: [{ type: "command", command: "x", bogus: true }] }] },
  });
  write(join(loose, ".mcp.json"), { mcpServers: { a: { command: "x", surprise: true } } });
});

afterEach(() => {
  cleanup();
  rmSync(claudeDir, { recursive: true, force: true });
});

async function detailFor(id: string): Promise<PluginDetail> {
  const plugin = (await listPlugins(claudeDir)).find((candidate) => candidate.id === id);
  if (plugin === undefined) throw new Error(`missing ${id}`);
  return readPluginDetail(plugin, { claudeDir });
}

describe("readPluginDetail", () => {
  it("reads hooks.json, .mcp.json and the marketplace entry", async () => {
    const detail = await detailFor("tools@market");
    expect({
      homepage: detail.homepage,
      categories: detail.categories,
      hooks: detail.hooks,
      connectors: detail.connectors,
      tree: detail.tree.map((node) => node.path),
    }).toStrictEqual({
      homepage: "https://tools.example.com",
      categories: ["development", "lint"],
      hooks: [
        { event: "PreToolUse", matcher: "Bash", handlers: ["guard.sh"] },
        { event: "Stop", matcher: "", handlers: ["recap.sh", "https://hooks.example.com/stop"] },
      ],
      connectors: [
        {
          id: "plugin:tools@market:docs",
          name: "docs",
          scope: "plugin",
          transport: "http",
          urlOrCommand: "https://docs.example.com/mcp",
          enabled: true,
          envKeys: [],
          headerKeys: ["Authorization"],
        },
      ],
      tree: [".claude-plugin", "agents", "commands", "hooks", "skills", ".mcp.json", "README.md"],
    });
  });

  it("rejects hooks.json and .mcp.json with unknown keys (strict schemas)", async () => {
    const detail = await detailFor("loose@market");
    expect({
      hooks: detail.hooks,
      connectors: detail.connectors,
      categories: detail.categories,
      homepage: detail.homepage,
    }).toStrictEqual({ hooks: [], connectors: [], categories: [], homepage: undefined });
  });
});

describe("pluginDetailTabs", () => {
  it("counts each tab from the fixture plugin and drops empty local-only tabs", async () => {
    expect([
      pluginDetailTabs(await detailFor("tools@market")),
      pluginDetailTabs(await detailFor("loose@market")),
    ]).toStrictEqual([
      [
        { id: "overview", label: "Overview", count: null },
        { id: "contents", label: "Contents", count: 7 },
        { id: "skills", label: "Skills", count: 1 },
        { id: "connectors", label: "Connectors", count: 1 },
        { id: "agents", label: "Agents", count: 1 },
        { id: "commands", label: "Commands", count: 1 },
        { id: "hooks", label: "Hooks", count: 2 },
      ],
      [
        { id: "overview", label: "Overview", count: null },
        { id: "contents", label: "Contents", count: 3 },
      ],
    ]);
  });
});

async function renderInRouter(element: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{element}</ToastProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

describe("plugin detail UI", () => {
  it("renders the header meta and one underline tab per non-empty section", async () => {
    await renderInRouter(<PluginDetailHeader detail={await detailFor("tools@market")} />);
    const nav = await screen.findByRole("navigation", { name: "Plugin sections" });
    expect({
      heading: screen.getByRole("heading", { level: 2 }).textContent,
      tabs: within(nav)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    }).toStrictEqual({
      heading: "tools",
      tabs: [
        ["Overview", "/customize/plugins/id/tools%40market"],
        ["Contents · 7", "/customize/plugins/id/tools%40market/contents"],
        ["Skills · 1", "/customize/plugins/id/tools%40market/skills"],
        ["Connectors · 1", "/customize/plugins/id/tools%40market/connectors"],
        ["Agents · 1", "/customize/plugins/id/tools%40market/agents"],
        ["Commands · 1", "/customize/plugins/id/tools%40market/commands"],
        ["Hooks · 2", "/customize/plugins/id/tools%40market/hooks"],
      ],
    });
  });

  it("lists hook events with their matcher and handlers", async () => {
    const detail = await detailFor("tools@market");
    render(<PluginHooks hooks={detail.hooks} />);
    expect(screen.getAllByTestId("plugin-hook-row").map((row) => row.textContent)).toStrictEqual([
      "PreToolUseBashguard.sh",
      "StopAnyrecap.shhttps://hooks.example.com/stop",
    ]);
  });
});

describe("plugin Contents tab", () => {
  it("preselects the ?file= path, falling back to README.md when it is not in the tree", async () => {
    const detail = await detailFor("tools@market");
    const pathShown = (initialFile: string) => {
      const queryClient = new QueryClient();
      const view = render(
        <QueryClientProvider client={queryClient}>
          <ContentsViewer
            name="tools 1.2.0"
            tree={detail.tree}
            initialFile={initialFile}
            fileQuery={(path) => ({
              queryKey: ["file", path],
              queryFn: () => new Promise<never>(() => {}),
            })}
          />
        </QueryClientProvider>,
      );
      const text = screen.getByTestId("contents-path").textContent;
      view.unmount();
      return text;
    };
    expect([pathShown("agents/reviewer.md"), pathShown("missing.md")]).toStrictEqual([
      "/agents/reviewer.md",
      "/README.md",
    ]);
  });
});

function legacyRouter(initialEntry: string) {
  const rootRoute = createRootRoute();
  const pluginsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/plugins",
    beforeLoad: redirectLegacyPlugins,
  });
  const pluginFileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/plugin/$id/$type/$",
    beforeLoad: redirectLegacyPluginFile,
  });
  const commandRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/command/$source/$filename",
    beforeLoad: redirectLegacyCommand,
  });
  const customizePlugins = createRoute({
    getParentRoute: () => rootRoute,
    path: "/customize/plugins",
  });
  const pluginDetail = createRoute({
    getParentRoute: () => rootRoute,
    path: "/customize/plugins/id/$pluginId",
  });
  const pluginContents = createRoute({
    getParentRoute: () => rootRoute,
    path: "/customize/plugins/id/$pluginId/contents",
  });
  const customizeSkills = createRoute({
    getParentRoute: () => rootRoute,
    path: "/customize/skills",
  });
  return createRouter({
    routeTree: rootRoute.addChildren([
      pluginsRoute,
      pluginFileRoute,
      commandRoute,
      customizePlugins,
      pluginDetail,
      pluginContents,
      customizeSkills,
    ]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
}

async function landing(initialEntry: string) {
  const router = legacyRouter(initialEntry);
  await router.load();
  const { pathname, hash } = router.state.location;
  return { pathname, search: router.state.location.searchStr, hash };
}

describe("legacy route redirects", () => {
  it("send /plugins, /plugin/$id/$type/$ and /command/$source/$filename into Customize", async () => {
    expect([
      await landing("/plugins"),
      await landing("/plugins#tools@market"),
      await landing("/plugin/tools@market/skills/format/SKILL~1md"),
      await landing("/plugin/tools@market/agents/reviewer~1md"),
      await landing("/command/global/ship"),
    ]).toStrictEqual([
      { pathname: "/customize/plugins", search: "", hash: "" },
      { pathname: "/customize/plugins/id/tools%40market", search: "", hash: "" },
      {
        pathname: "/customize/plugins/id/tools%40market/contents",
        search: "?file=skills%2Fformat%2FSKILL.md",
        hash: "",
      },
      {
        pathname: "/customize/plugins/id/tools%40market/contents",
        search: "?file=agents%2Freviewer.md",
        hash: "",
      },
      { pathname: "/customize/skills", search: "?filter=command", hash: "" },
    ]);
  });
});

describe("commandRows", () => {
  const groups = [
    {
      source: "global",
      sourceName: "Global",
      commands: [
        {
          filename: "ship.md",
          name: "Ship",
          description: "Ships it",
          type: "command" as const,
          frontmatter: {},
        },
        {
          filename: "audit.md",
          name: "Audit",
          description: "Audits deps",
          type: "command" as const,
          frontmatter: {},
        },
      ],
    },
  ];

  it("lists legacy commands as /name rows for All and the command filter only", () => {
    expect([
      commandRows(groups, "all", undefined),
      commandRows(groups, "command", "ship"),
      commandRows(groups, "personal", undefined),
    ]).toStrictEqual([
      [
        {
          key: "global:audit.md",
          invocation: "/audit",
          sourceName: "Global",
          description: "Audits deps",
        },
        {
          key: "global:ship.md",
          invocation: "/ship",
          sourceName: "Global",
          description: "Ships it",
        },
      ],
      [
        {
          key: "global:ship.md",
          invocation: "/ship",
          sourceName: "Global",
          description: "Ships it",
        },
      ],
      [],
    ]);
  });
});
