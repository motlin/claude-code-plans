// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ApplicationConfigurationSection } from "../src/components/settings/settings-sections";

describe("application settings controls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists Herdr input, Shell tabs, and watcher exclusions through the server API", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    let settings = {
      herdrWritesEnabled: false,
      shellPaneEnabled: true,
      visibleNavSections: ["herdr", "plans", "memories", "customize"],
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

    const herdrInputToggle = await screen.findByRole("switch", { name: "Live Herdr input" });
    const shellTabsToggle = screen.getByRole("switch", { name: "Shell tabs" });
    const ignoredDirectories = screen.getByRole("textbox", {
      name: "Ignored watcher directories",
    }) as HTMLTextAreaElement;
    expect({
      herdrInput: herdrInputToggle.getAttribute("aria-checked"),
      shellTabs: shellTabsToggle.getAttribute("aria-checked"),
      sectionToggles: screen.queryAllByRole("switch", { name: /section$/ }),
      immediate: screen.getByText(/Applies immediately without a server restart/).textContent,
      pollingToggle: screen.queryByRole("switch", { name: "Polling file watcher" }),
      restartNotices: screen.getAllByText(/Restart the server/).length,
      ignoredDirectories: ignoredDirectories.value,
    }).toStrictEqual({
      herdrInput: "false",
      shellTabs: "true",
      sectionToggles: [],
      immediate:
        "Allow prompts, interrupts, and state reports for live Herdr terminals. Applies immediately without a server restart.",
      pollingToggle: null,
      restartNotices: 1,
      ignoredDirectories: "dist\nnode_modules",
    });

    fireEvent.click(herdrInputToggle);
    await waitFor(() => expect(herdrInputToggle.getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(shellTabsToggle);
    await waitFor(() => expect(shellTabsToggle.getAttribute("aria-checked")).toBe("false"));

    fireEvent.change(ignoredDirectories, {
      target: { value: "node_modules\ncustom-cache" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save ignored directories" }));
    await waitFor(() => expect(requests).toHaveLength(3));
    await waitFor(() => expect(ignoredDirectories.value).toBe("custom-cache\nnode_modules"));

    expect(requests).toStrictEqual([
      {
        method: "PUT",
        body: {
          herdrWritesEnabled: true,
          shellPaneEnabled: true,
          visibleNavSections: ["herdr", "plans", "memories", "customize"],
          ignoredDirs: ["dist", "node_modules"],
        },
      },
      {
        method: "PUT",
        body: {
          herdrWritesEnabled: true,
          shellPaneEnabled: false,
          visibleNavSections: ["herdr", "plans", "memories", "customize"],
          ignoredDirs: ["dist", "node_modules"],
        },
      },
      {
        method: "PUT",
        body: {
          herdrWritesEnabled: true,
          shellPaneEnabled: false,
          visibleNavSections: ["herdr", "plans", "memories", "customize"],
          ignoredDirs: ["custom-cache", "node_modules"],
        },
      },
    ]);
  });

  it("renders the saved ignored directories in the same commit that first shows the form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({
          herdrWritesEnabled: false,
          shellPaneEnabled: true,
          visibleNavSections: ["herdr"],
          ignoredDirs: ["node_modules", "dist"],
        }),
      ),
    );
    const firstCommittedValues: string[] = [];
    const observer = new MutationObserver(() => {
      const textarea = document.querySelector("textarea");
      if (textarea !== null && firstCommittedValues.length === 0) {
        firstCommittedValues.push(textarea.value);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ApplicationConfigurationSection />
      </QueryClientProvider>,
    );
    await screen.findByRole("textbox", { name: "Ignored watcher directories" });
    observer.disconnect();

    expect(firstCommittedValues).toStrictEqual(["dist\nnode_modules"]);
  });
});
