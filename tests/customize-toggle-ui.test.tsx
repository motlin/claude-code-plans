// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { PluginEnableMenuItem } from "../src/components/customize/plugin-row-actions";
import { SkillEnableSwitch } from "../src/components/customize/skill-enable-switch";
import { ToastProvider } from "../src/components/toast";
import { Menu, MenuContent, MenuTrigger } from "../src/components/ui/menu";
import {
  customizeSettingsTogglesQueryOptions,
  type SettingsToggleState,
  type SkillSummary,
} from "../src/lib/api/customize";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STATE: SettingsToggleState = {
  mtimeMs: 1000,
  skillOverrides: { legacy: "name-only" },
  enabledPlugins: { "tools@market": true },
};

const DEPLOY: SkillSummary = {
  id: "personal:deploy",
  name: "deploy",
  description: "Ship it",
  source: "personal",
  sourceLabel: "Personal",
  dir: "/Users/test/.claude/skills/deploy",
  mtime: 0,
  enabled: true,
};

function renderWithState(ui: ReactNode, state: SettingsToggleState = STATE) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(customizeSettingsTogglesQueryOptions.queryKey, state);
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

function postBodies(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): unknown[] {
  return fetcher.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([url, init]) => ({ url, body: JSON.parse(init?.body as string) }));
}

describe("SkillEnableSwitch", () => {
  it("turns a skill off optimistically, posts the guarded toggle and toasts", async () => {
    let release: (() => void) | undefined;
    let onDisk = STATE;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method !== "POST") return Response.json(onDisk);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      onDisk = { ...STATE, mtimeMs: 2000, skillOverrides: { legacy: "name-only", deploy: "off" } };
      return Response.json(onDisk);
    });
    vi.stubGlobal("fetch", fetcher);
    renderWithState(<SkillEnableSwitch skill={DEPLOY} />);

    const toggle = screen.getByRole("switch", { name: "Enable skill" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(toggle);
    });
    await waitFor(() => expect(release).toBeDefined());
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
    await act(async () => {
      release?.();
    });

    expect(await screen.findByText("deploy disabled")).toBeTruthy();
    expect(postBodies(fetcher)).toStrictEqual([
      {
        url: "/api/customize/settings-toggles",
        body: {
          expectedMtimeMs: 1000,
          toggle: { kind: "skill", name: "deploy", enabled: false },
        },
      },
    ]);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("rolls back and explains a conflict when settings.json changed on disk", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === "POST" ? Response.json(STATE, { status: 409 }) : Response.json(STATE),
    );
    vi.stubGlobal("fetch", fetcher);
    renderWithState(<SkillEnableSwitch skill={DEPLOY} />);

    const toggle = screen.getByRole("switch", { name: "Enable skill" });
    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(
      await screen.findByText("settings.json changed on disk. Review and try again."),
    ).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("is read-only for plugin skills, which follow their plugin", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json(STATE)),
    );
    renderWithState(
      <SkillEnableSwitch
        skill={{
          ...DEPLOY,
          id: "plugin:tools@market:format",
          source: "plugin",
          sourceLabel: "tools",
        }}
      />,
    );
    const toggle = screen.getByRole("switch", { name: "Enable skill" });
    expect({
      checked: toggle.getAttribute("aria-checked"),
      disabled: toggle.getAttribute("aria-disabled"),
    }).toStrictEqual({ checked: "true", disabled: "true" });
  });
});

describe("PluginEnableMenuItem", () => {
  it("disables an enabled plugin via enabledPlugins", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === "POST"
        ? Response.json({ ...STATE, mtimeMs: 2000, enabledPlugins: { "tools@market": false } })
        : Response.json(STATE),
    );
    vi.stubGlobal("fetch", fetcher);
    renderWithState(
      <Menu>
        <MenuTrigger aria-label="More actions for tools">…</MenuTrigger>
        <MenuContent>
          <PluginEnableMenuItem pluginId="tools@market" name="tools" />
        </MenuContent>
      </Menu>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions for tools" }));
    const menu = await screen.findByRole("menu");
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Disable" }));
    });

    expect(await screen.findByText("tools disabled")).toBeTruthy();
    expect(postBodies(fetcher)).toStrictEqual([
      {
        url: "/api/customize/settings-toggles",
        body: {
          expectedMtimeMs: 1000,
          toggle: { kind: "plugin", id: "tools@market", enabled: false },
        },
      },
    ]);
  });
});
