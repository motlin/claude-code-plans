// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_FILE_SOURCE_SELECTION,
  FILE_SOURCE_SELECTION_STORAGE_KEY,
  FilesPaneShortcut,
  FilesPaneView,
} from "../src/components/panes/files-pane";
import { sessionFileLabel } from "../src/components/panes/session-files-list";
import { registerPane } from "../src/components/panes/pane-registry";
import { TileHost } from "../src/components/panes/tile-host";
import { SettingsProvider } from "../src/components/settings-provider";
import { decodeFilePath } from "../src/lib/api/file";
import type { SessionFilesResponse } from "../src/lib/api/session-files";
import { writeClipboardText } from "../src/lib/clipboard";
import type { SessionFiles } from "../src/lib/session-files";
import { installLocalStorage } from "./fake-storage";

vi.mock("../src/lib/clipboard", () => ({
  writeClipboardText: vi.fn(),
}));

const SESSION_ID = "session-mode";
const CWD = "/home/alice/example";

const SESSION_FILES = {
  files: [
    {
      path: "~/example/agent.ts",
      absolutePath: "/home/alice/example/agent.ts",
      occurrences: [
        { source: "visible", anchorIndex: 10, role: "assistant" },
        { source: "tool", anchorIndex: 20, role: "assistant", tool: "Read" },
      ],
    },
    {
      path: "~/example/src/read-only.ts",
      absolutePath: "/home/alice/example/src/read-only.ts",
      occurrences: [{ source: "tool", anchorIndex: 30, role: "assistant", tool: "Read" }],
    },
    {
      path: "~/notes/user.md",
      absolutePath: "/home/alice/notes/user.md",
      occurrences: [{ source: "visible", anchorIndex: 40, role: "user" }],
    },
  ],
  totalCount: 3,
  counts: {
    userMessage: 1,
    agentMessage: 1,
    read: 2,
    editWrite: 0,
    bash: 0,
    grepGlob: 0,
    thinking: 0,
    other: 0,
  },
} satisfies SessionFiles;

const ROOT_LISTING: SessionFilesResponse = {
  kind: "listing",
  dir: "",
  entries: [
    { name: "src", relPath: "src", isDirectory: true },
    { name: "agent.ts", relPath: "agent.ts", isDirectory: false },
  ],
  partial: false,
};

class FakeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

let listing: SessionFilesResponse;
let fileContents: Map<string, string>;
let fileRequests: string[];

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname.startsWith("/api/sessions/")) return Response.json(listing);
      if (url.pathname.startsWith("/api/file/")) {
        const path = decodeFilePath(url.pathname.slice("/api/file/".length)) ?? "";
        fileRequests.push(path);
        const content = fileContents.get(path);
        if (content === undefined) {
          return Response.json({ error: "File not found" }, { status: 404 });
        }
        return Response.json({ content, path });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    }),
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let unregister: () => void = () => {};

interface OpenOptions {
  sessionFiles?: SessionFiles;
  unscanned?: number;
  sessionId?: string;
  /** Press ⇧⌘F after rendering; off when the stored layout already has the pane open. */
  toggle?: boolean;
}

async function openPane({
  sessionFiles = SESSION_FILES,
  unscanned = 0,
  sessionId = SESSION_ID,
  toggle = true,
}: OpenOptions = {}): Promise<HTMLElement> {
  unregister = registerPane("files", {
    title: "Files",
    header: "custom",
    render: (chrome) => (
      <FilesPaneView
        chrome={chrome}
        sessionId={sessionId}
        cwd={CWD}
        sessionFiles={sessionFiles}
        unscannedRecordCount={unscanned}
      />
    ),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <TileHost sessionId={SESSION_ID} onExpandWithoutPane={() => {}}>
          <FilesPaneShortcut />
        </TileHost>
      </SettingsProvider>
    </QueryClientProvider>,
  );
  if (toggle) pressFilesShortcut();
  await flush();
  return screen.getByRole("region", { name: "Files" });
}

function pressFilesShortcut(): void {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "f",
        code: "KeyF",
        metaKey: true,
        shiftKey: true,
      }),
    );
  });
}

function filterInput(pane: HTMLElement): HTMLInputElement {
  return within(pane).getByLabelText("Filter files") as HTMLInputElement;
}

function sessionRows(pane: HTMLElement): Array<string | null> {
  return [...pane.querySelectorAll("[data-session-file-open]")].map((row) => row.textContent);
}

function modeState(pane: HTMLElement): Array<[string, string | null]> {
  return within(pane)
    .getAllByRole("radio")
    .map((radio) => [radio.textContent ?? "", radio.getAttribute("aria-checked")]);
}

async function switchMode(pane: HTMLElement, mode: "Workspace" | "Session"): Promise<void> {
  fireEvent.click(within(pane).getByRole("radio", { name: mode }));
  await flush();
}

async function openSourcesSubmenu(pane: HTMLElement): Promise<void> {
  fireEvent.click(within(pane).getByRole("button", { name: "Files settings" }));
  await flush();
  const trigger = screen.getByRole("menuitem", { name: /Show files from/ });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
  await flush();
}

function sourceItems(): Array<[string, string | null]> {
  return screen
    .getAllByRole("menuitemcheckbox")
    .filter((item) => /\(\d+\)$/.test(item.textContent ?? ""))
    .map((item) => [item.textContent ?? "", item.getAttribute("aria-checked")]);
}

beforeEach(() => {
  installLocalStorage();
  listing = ROOT_LISTING;
  fileContents = new Map();
  fileRequests = [];
  stubFetch();
  vi.mocked(writeClipboardText).mockReset();
  vi.stubGlobal("ResizeObserver", FakeObserver);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 1200, height: 800 }),
  );
});

afterEach(() => {
  unregister();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sessionFileLabel", () => {
  it.each([
    ["inside the working directory", "/home/alice/example/src/a.ts", CWD, "src/a.ts"],
    ["the working directory itself", CWD, CWD, CWD],
    ["a sibling sharing a prefix", "/home/alice/example-2/a.ts", CWD, "/home/alice/example-2/a.ts"],
    [
      "outside the working directory",
      "/home/alice/notes/user.md",
      CWD,
      "/home/alice/notes/user.md",
    ],
    ["a trailing slash on the cwd", "/home/alice/example/a.ts", `${CWD}/`, "a.ts"],
    ["no working directory", "/home/alice/example/a.ts", undefined, "/home/alice/example/a.ts"],
  ])("%s", (_name, absolutePath, cwd, expected) => {
    expect(sessionFileLabel(absolutePath, cwd)).toBe(expected);
  });
});

describe("Files pane mode switch", () => {
  it("defaults to Workspace and keeps the filter query across mode switches", async () => {
    const pane = await openPane();
    const initial = modeState(pane);

    fireEvent.change(filterInput(pane), { target: { value: "AGENT" } });
    await switchMode(pane, "Session");
    const inSession = {
      mode: modeState(pane),
      query: filterInput(pane).value,
      rows: sessionRows(pane),
      tree: within(pane).queryByRole("tree", { name: "Project files" }),
    };
    await switchMode(pane, "Workspace");

    expect({
      group: within(pane).getByRole("radiogroup").getAttribute("aria-label"),
      initial,
      inSession,
      backInWorkspace: {
        mode: modeState(pane),
        query: filterInput(pane).value,
        rows: sessionRows(pane),
      },
    }).toStrictEqual({
      group: "File list",
      initial: [
        ["Workspace", "true"],
        ["Session", "false"],
      ],
      inSession: {
        mode: [
          ["Workspace", "false"],
          ["Session", "true"],
        ],
        query: "AGENT",
        rows: ["agent.ts"],
        tree: null,
      },
      backInWorkspace: {
        mode: [
          ["Workspace", "true"],
          ["Session", "false"],
        ],
        query: "AGENT",
        rows: [],
      },
    });
  });

  it("offers only the Session list when the session has no working directory", async () => {
    listing = { kind: "no-cwd" };
    const pane = await openPane();

    await waitFor(() => expect(sessionRows(pane)).toHaveLength(3));
    expect({
      radios: within(pane).queryAllByRole("radio"),
      tree: within(pane).queryByRole("tree", { name: "Project files" }),
    }).toStrictEqual({ radios: [], tree: null });
  });
});

describe("Session mode rows", () => {
  it("labels paths relative to cwd, absolute outside it, with hover jump chips", async () => {
    const pane = await openPane();
    await switchMode(pane, "Session");

    const rows = [...pane.querySelectorAll<HTMLElement>("[data-session-file]")].map((row) => ({
      label: row.querySelector("[data-session-file-open]")?.textContent,
      title: row.querySelector("[data-session-file-open]")?.getAttribute("title"),
      direction: row.querySelector("[data-session-file-open]")?.getAttribute("dir"),
      chips: within(row.querySelector<HTMLElement>("[data-jump-popover]") ?? row)
        .getAllByRole("button", { name: /^Jump to file mention/ })
        .map((chip) => chip.textContent),
    }));

    expect(rows).toStrictEqual([
      {
        label: "agent.ts",
        title: "/home/alice/example/agent.ts",
        direction: "rtl",
        chips: ["1", "2"],
      },
      {
        label: "src/read-only.ts",
        title: "/home/alice/example/src/read-only.ts",
        direction: "rtl",
        chips: ["1"],
      },
      {
        label: "/home/alice/notes/user.md",
        title: "/home/alice/notes/user.md",
        direction: "rtl",
        chips: ["1"],
      },
    ]);
  });

  it("filters the displayed labels case-insensitively", async () => {
    const pane = await openPane();
    await switchMode(pane, "Session");

    fireEvent.change(filterInput(pane), { target: { value: "SRC/" } });
    const src = sessionRows(pane);
    fireEvent.change(filterInput(pane), { target: { value: "zzz" } });

    expect({
      src,
      none: sessionRows(pane),
      emptyMessage: within(pane).getByText("No files match “zzz”.").textContent,
    }).toStrictEqual({
      src: ["src/read-only.ts"],
      none: [],
      emptyMessage: "No files match “zzz”.",
    });
  });

  it("reports a coverage note while the transcript window hides earlier records", async () => {
    const pane = await openPane({ unscanned: 3200 });
    await switchMode(pane, "Session");

    expect(within(pane).getByRole("note").textContent).toBe(
      "Counted from the loaded messages only — 3200 earlier records have not been scanned. Load earlier messages to include them.",
    );
  });

  it("copies the absolute path and confirms only a successful write", async () => {
    vi.mocked(writeClipboardText).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const pane = await openPane();
    await switchMode(pane, "Session");
    const copyButton = within(pane).getByRole("button", {
      name: "Copy /home/alice/example/agent.ts",
    });

    fireEvent.click(copyButton);
    await waitFor(() =>
      expect(vi.mocked(writeClipboardText).mock.calls).toStrictEqual([
        ["/home/alice/example/agent.ts"],
      ]),
    );
    expect(copyButton.getAttribute("title")).toBe("Copy absolute path");

    fireEvent.click(copyButton);
    await waitFor(() => expect(copyButton.getAttribute("title")).toBe("Copied"));
  });
});

describe("Show files from submenu", () => {
  it("lists every source with its count and filters rows by the selection", async () => {
    const pane = await openPane();
    await switchMode(pane, "Session");
    await openSourcesSubmenu(pane);
    const initial = sourceItems();

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Read (2)" }));
    await flush();

    expect({ initial, after: sourceItems(), rows: sessionRows(pane) }).toStrictEqual({
      initial: [
        ["User message (1)", "true"],
        ["Agent message (1)", "true"],
        ["Read (2)", "true"],
        ["Edit/Write (0)", "true"],
        ["Bash (0)", "true"],
        ["Grep/Glob (0)", "true"],
        ["Thinking (0)", "true"],
        ["Other (0)", "true"],
      ],
      after: [
        ["User message (1)", "true"],
        ["Agent message (1)", "true"],
        ["Read (2)", "false"],
        ["Edit/Write (0)", "true"],
        ["Bash (0)", "true"],
        ["Grep/Glob (0)", "true"],
        ["Thinking (0)", "true"],
        ["Other (0)", "true"],
      ],
      rows: ["agent.ts", "/home/alice/notes/user.md"],
    });
  });

  it("Unselect all removes every row and persists the selection", async () => {
    const pane = await openPane();
    await switchMode(pane, "Session");
    await openSourcesSubmenu(pane);

    fireEvent.click(screen.getByRole("menuitem", { name: "Unselect all" }));
    await flush();

    expect({
      rows: sessionRows(pane),
      emptyMessage: within(pane).getByText("No files match the selected sources.").textContent,
    }).toStrictEqual({ rows: [], emptyMessage: "No files match the selected sources." });
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem(FILE_SOURCE_SELECTION_STORAGE_KEY) ?? "null"),
      ).toStrictEqual({
        userMessage: false,
        agentMessage: false,
        read: false,
        editWrite: false,
        bash: false,
        grepGlob: false,
        thinking: false,
        other: false,
      }),
    );
  });

  it("hydrates a stored source selection", async () => {
    localStorage.setItem(
      FILE_SOURCE_SELECTION_STORAGE_KEY,
      JSON.stringify({
        userMessage: false,
        agentMessage: true,
        read: false,
        editWrite: true,
        bash: false,
        grepGlob: true,
        thinking: false,
        other: true,
      }),
    );
    const pane = await openPane();
    await openSourcesSubmenu(pane);

    expect(sourceItems().map(([, checked]) => checked)).toStrictEqual([
      "false",
      "true",
      "false",
      "true",
      "false",
      "true",
      "false",
      "true",
    ]);
  });

  it("ignores a malformed or incomplete stored source selection", async () => {
    localStorage.setItem(
      FILE_SOURCE_SELECTION_STORAGE_KEY,
      JSON.stringify({ userMessage: false, read: "yes" }),
    );
    const pane = await openPane();

    await waitFor(() =>
      expect(localStorage.getItem(FILE_SOURCE_SELECTION_STORAGE_KEY)).toBe(
        JSON.stringify(DEFAULT_FILE_SOURCE_SELECTION),
      ),
    );
    await openSourcesSubmenu(pane);
    expect(sourceItems().map(([, checked]) => checked)).toStrictEqual([
      "true",
      "true",
      "true",
      "true",
      "true",
      "true",
      "true",
      "true",
    ]);
  });
});

describe("Opening a session file", () => {
  it("clicking a row opens the file in the viewer", async () => {
    fileContents.set("/home/alice/example/agent.ts", "export const agent = 1;\n");
    const pane = await openPane();
    await switchMode(pane, "Session");

    fireEvent.click(within(pane).getByRole("button", { name: "agent.ts" }));
    await waitFor(() => expect(within(pane).getByText("export const agent = 1;")).toBeDefined());

    expect({
      requests: fileRequests,
      current: within(pane).getByRole("button", { name: "agent.ts" }).getAttribute("aria-current"),
      emptyState: within(pane).queryByText("Open files appear here"),
    }).toStrictEqual({
      requests: ["/home/alice/example/agent.ts"],
      current: "true",
      emptyState: null,
    });
  });

  it("shows Couldn’t find this file when the file no longer exists", async () => {
    const pane = await openPane();
    await switchMode(pane, "Session");

    fireEvent.click(within(pane).getByRole("button", { name: "/home/alice/notes/user.md" }));

    await waitFor(() =>
      expect(within(pane).getByText("Couldn’t find this file").textContent).toBe(
        "Couldn’t find this file",
      ),
    );
    expect(within(pane).getByText("/home/alice/notes/user.md", { selector: "p" }).tagName).toBe(
      "P",
    );
  });
});

function tabStrip(
  pane: HTMLElement,
): Array<{ name: string; selected: string | null; italic: boolean }> {
  const list = within(pane).queryByRole("tablist", { name: "Open files" });
  if (list === null) return [];
  return within(list)
    .getAllByRole("tab")
    .map((tab) => ({
      name: tab.textContent ?? "",
      selected: tab.getAttribute("aria-selected"),
      italic: tab.className.split(/\s+/).includes("italic"),
    }));
}

async function treeFile(pane: HTMLElement, name: string): Promise<HTMLElement> {
  return waitFor(() => {
    const row = [...pane.querySelectorAll<HTMLElement>("[data-tree-row]")].find(
      (candidate) => candidate.querySelector("[data-tree-name]")?.textContent === name,
    );
    const button = row?.querySelector<HTMLElement>("[data-tree-primary]");
    if (!button) throw new Error(`no tree row ${name}`);
    return button;
  });
}

describe("File tabs", () => {
  beforeEach(() => {
    fileContents.set("/home/alice/example/agent.ts", "export const agent = 1;\n");
    fileContents.set("/home/alice/example/src/read-only.ts", "export const ro = 1;\n");
  });

  it("a tree click opens an italic preview tab that replaces the header title", async () => {
    const pane = await openPane();
    expect(within(pane).queryByText("Files", { selector: "[data-pane-title]" })).not.toBeNull();

    fireEvent.click(await treeFile(pane, "agent.ts"));
    await flush();

    expect({
      tabs: tabStrip(pane),
      title: within(pane).queryByText("Files", { selector: "[data-pane-title]" }),
      tabName: within(pane).getByRole("tab").getAttribute("aria-label"),
    }).toStrictEqual({
      tabs: [{ name: "agent.ts, preview", selected: "true", italic: true }],
      title: null,
      tabName: null,
    });
    await waitFor(() => expect(fileRequests).toStrictEqual(["/home/alice/example/agent.ts"]));
  });

  it("a double-click pins, and the next click opens a new preview tab beside it", async () => {
    const pane = await openPane();
    fireEvent.doubleClick(await treeFile(pane, "agent.ts"));
    await flush();
    await switchMode(pane, "Session");
    fireEvent.click(within(pane).getByRole("button", { name: "src/read-only.ts" }));
    await flush();
    fireEvent.click(within(pane).getByRole("button", { name: "/home/alice/notes/user.md" }));
    await flush();

    expect(tabStrip(pane)).toStrictEqual([
      { name: "agent.ts", selected: "false", italic: false },
      { name: "user.md, preview", selected: "true", italic: true },
    ]);
  });

  it("double-clicking a preview tab pins it", async () => {
    const pane = await openPane();
    fireEvent.click(await treeFile(pane, "agent.ts"));
    await flush();
    const row = (await treeFile(pane, "agent.ts")).closest("[data-tree-row]");
    const previewRow = [row?.getAttribute("aria-current"), row?.getAttribute("aria-selected")];
    fireEvent.doubleClick(within(pane).getByRole("tab"));
    await flush();

    expect({
      tabs: tabStrip(pane),
      previewRow,
      pinnedRow: [row?.getAttribute("aria-current"), row?.getAttribute("aria-selected")],
    }).toStrictEqual({
      tabs: [{ name: "agent.ts", selected: "true", italic: false }],
      previewRow: ["true", "false"],
      pinnedRow: ["true", "true"],
    });
  });

  it("Delete closes the focused tab and ⌃⇧→ moves it", async () => {
    const pane = await openPane();
    await switchMode(pane, "Session");
    fireEvent.doubleClick(within(pane).getByRole("button", { name: "agent.ts" }));
    await flush();
    fireEvent.doubleClick(within(pane).getByRole("button", { name: "src/read-only.ts" }));
    await flush();
    fireEvent.doubleClick(within(pane).getByRole("button", { name: "/home/alice/notes/user.md" }));
    await flush();

    const [first] = within(pane).getAllByRole("tab");
    if (!first) throw new Error("no tab");
    fireEvent.keyDown(first, { key: "ArrowRight", ctrlKey: true, shiftKey: true });
    await flush();
    const moved = tabStrip(pane).map((tab) => tab.name);
    const readOnly = within(pane).getByRole("tab", { name: "read-only.ts" });
    fireEvent.keyDown(readOnly, { key: "Delete" });
    await flush();

    expect({ moved, closed: tabStrip(pane) }).toStrictEqual({
      moved: ["read-only.ts", "agent.ts", "user.md"],
      closed: [
        { name: "agent.ts", selected: "false", italic: false },
        { name: "user.md", selected: "true", italic: false },
      ],
    });
  });

  it("the close button closes a tab and the last close restores the title", async () => {
    const pane = await openPane();
    fireEvent.click(await treeFile(pane, "agent.ts"));
    await flush();
    fireEvent.click(within(pane).getByRole("button", { name: "Close agent.ts" }));
    await flush();

    expect({
      tabs: tabStrip(pane),
      title: within(pane).queryByText("Files", { selector: "[data-pane-title]" })?.textContent,
      empty: within(pane).queryByText("Open files appear here")?.textContent,
    }).toStrictEqual({ tabs: [], title: "Files", empty: "Open files appear here" });
  });

  it("with Preview tabs off, every open pins", async () => {
    const pane = await openPane();
    fireEvent.click(within(pane).getByRole("button", { name: "Files settings" }));
    await flush();
    const item = screen.getByRole("menuitemcheckbox", { name: "Preview tabs" });
    const checkedByDefault = item.getAttribute("aria-checked");
    fireEvent.click(item);
    await flush();
    fireEvent.click(await treeFile(pane, "agent.ts"));
    await flush();
    await switchMode(pane, "Session");
    fireEvent.click(within(pane).getByRole("button", { name: "src/read-only.ts" }));
    await flush();

    expect({ checkedByDefault, tabs: tabStrip(pane) }).toStrictEqual({
      checkedByDefault: "true",
      tabs: [
        { name: "agent.ts", selected: "false", italic: false },
        { name: "read-only.ts", selected: "true", italic: false },
      ],
    });
  });

  it("persists tabs per session and discards them when the pane closes", async () => {
    const pane = await openPane();
    fireEvent.doubleClick(await treeFile(pane, "agent.ts"));
    await flush();
    cleanup();
    unregister();

    const reopened = await openPane({ toggle: false });
    const restored = tabStrip(reopened);
    pressFilesShortcut();
    await flush();
    cleanup();
    unregister();

    const afterClose = await openPane();
    expect({ restored, afterClose: tabStrip(afterClose) }).toStrictEqual({
      restored: [{ name: "agent.ts", selected: "true", italic: false }],
      afterClose: [],
    });
  });
});
