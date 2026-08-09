// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ApplicationConfigurationSection } from "../src/routes/settings";

describe("application settings controls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists navigation, Herdr, and watcher exclusions through the server API", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    let settings = {
      herdrWritesEnabled: false,
      showHerdrSection: true,
      showTmuxSection: false,
      ignoredDirs: ["node_modules", "dist"],
    };
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
        settings = JSON.parse(init.body);
        requests.push({ method, body: settings });
      }
      return Response.json(settings);
    });
    vi.stubGlobal("fetch", fetcher);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ApplicationConfigurationSection />
      </QueryClientProvider>,
    );

    const herdrSectionToggle = await screen.findByRole("switch", { name: "Herdr section" });
    const tmuxSectionToggle = screen.getByRole("switch", { name: "Tmux section" });
    const herdrInputToggle = screen.getByRole("switch", { name: "Live Herdr input" });
    expect({
      checked: {
        herdrSection: herdrSectionToggle.getAttribute("aria-checked"),
        tmuxSection: tmuxSectionToggle.getAttribute("aria-checked"),
        herdrInput: herdrInputToggle.getAttribute("aria-checked"),
      },
      immediate: screen.getByText(/Applies immediately without a server restart/).textContent,
      pollingToggle: screen.queryByRole("switch", { name: "Polling file watcher" }),
      restartNotices: screen.getAllByText(/Restart the server/).length,
    }).toStrictEqual({
      checked: { herdrSection: "true", tmuxSection: "false", herdrInput: "false" },
      immediate:
        "Allow prompts, interrupts, and state reports for live Herdr terminals. Applies immediately without a server restart.",
      pollingToggle: null,
      restartNotices: 1,
    });

    fireEvent.click(tmuxSectionToggle);
    await waitFor(() => expect(tmuxSectionToggle.getAttribute("aria-checked")).toBe("true"));

    fireEvent.click(herdrSectionToggle);
    await waitFor(() => expect(herdrSectionToggle.getAttribute("aria-checked")).toBe("false"));

    fireEvent.click(herdrInputToggle);
    await waitFor(() => expect(herdrInputToggle.getAttribute("aria-checked")).toBe("true"));

    fireEvent.change(screen.getByRole("textbox", { name: "Ignored watcher directories" }), {
      target: { value: "node_modules\ncustom-cache" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save ignored directories" }));
    await waitFor(() => expect(requests).toHaveLength(4));

    expect(requests).toStrictEqual([
      {
        method: "PUT",
        body: {
          herdrWritesEnabled: false,
          showHerdrSection: true,
          showTmuxSection: true,
          ignoredDirs: ["node_modules", "dist"],
        },
      },
      {
        method: "PUT",
        body: {
          herdrWritesEnabled: false,
          showHerdrSection: false,
          showTmuxSection: true,
          ignoredDirs: ["node_modules", "dist"],
        },
      },
      {
        method: "PUT",
        body: {
          herdrWritesEnabled: true,
          showHerdrSection: false,
          showTmuxSection: true,
          ignoredDirs: ["node_modules", "dist"],
        },
      },
      {
        method: "PUT",
        body: {
          herdrWritesEnabled: true,
          showHerdrSection: false,
          showTmuxSection: true,
          ignoredDirs: ["node_modules", "custom-cache"],
        },
      },
    ]);
  });
});
