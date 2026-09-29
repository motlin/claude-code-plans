// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_FILE_SOURCE_SELECTION,
  FILE_SOURCE_SELECTION_STORAGE_KEY,
  FilesPaneShortcut,
  FilesPaneToggle,
  FilesPaneView,
  filesEmptyState,
} from "../src/components/panes/files-pane";
import { registerPane } from "../src/components/panes/pane-registry";
import { TileHost } from "../src/components/panes/tile-host";
import { SettingsProvider } from "../src/components/settings-provider";
import { writeClipboardText } from "../src/lib/clipboard";
import type { SessionFiles } from "../src/lib/session-files";
import { installLocalStorage } from "./fake-storage";

vi.mock("../src/lib/clipboard", () => ({
  writeClipboardText: vi.fn(),
}));

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
      path: "~/example/read-only.ts",
      absolutePath: "/home/alice/example/read-only.ts",
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

class FakeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

const CMD_SHIFT_F = { key: "f", code: "KeyF", metaKey: true, shiftKey: true };
const CTRL_SHIFT_F = { key: "F", code: "KeyF", ctrlKey: true, shiftKey: true };
const CTRL_SHIFT_Y = { key: "Y", code: "KeyY", ctrlKey: true, shiftKey: true };

let unregister: () => void = () => {};

function registerFilesPane(sessionFiles: SessionFiles = SESSION_FILES, unscanned = 0): void {
  unregister = registerPane("files", {
    title: "Files",
    header: "custom",
    render: (chrome) => (
      <FilesPaneView chrome={chrome} sessionFiles={sessionFiles} unscannedRecordCount={unscanned} />
    ),
  });
}

function renderSession(onExpandWithoutPane: () => void = () => {}) {
  return render(
    <SettingsProvider>
      <TileHost sessionId="files-pane" onExpandWithoutPane={onExpandWithoutPane}>
        <FilesPaneShortcut />
        <FilesPaneToggle count={SESSION_FILES.totalCount} />
      </TileHost>
    </SettingsProvider>,
  );
}

function filesPane(): HTMLElement {
  return screen.getByRole("region", { name: "Files" });
}

function filesPressed(): string | null {
  return screen.getByRole("button", { name: /^Files \d/ }).getAttribute("aria-pressed");
}

function visiblePaths(): Array<string | null> {
  return screen.queryAllByTitle(/^~\//).map((element) => element.textContent);
}

beforeEach(() => {
  installLocalStorage();
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

describe("filesEmptyState", () => {
  it.each([
    [
      "no tabs, tree available",
      true,
      0,
      {
        title: "Open files appear here",
        detail: "Pick a file in the tree, or click a file path in the conversation.",
      },
    ],
    [
      "no tabs, no tree",
      false,
      0,
      {
        title: "Open files appear here",
        detail: "Click a file path in the conversation to open it.",
      },
    ],
    [
      "tabs open, none selected (tree shown)",
      true,
      2,
      {
        title: "No file selected",
        detail: "Pick an open file above, or click a file path in the conversation.",
      },
    ],
    [
      "tabs open, none selected (tree hidden)",
      false,
      1,
      {
        title: "No file selected",
        detail: "Pick an open file above, or click a file path in the conversation.",
      },
    ],
  ])("%s", (_name, hasTree, tabCount, expected) => {
    expect(filesEmptyState(hasTree, tabCount)).toStrictEqual(expected);
  });
});

describe("Files pane shortcut", () => {
  it("⇧⌘F toggles the pane, focuses the filter, and never toggles chromeHidden", () => {
    registerFilesPane();
    const onExpandWithoutPane = vi.fn();
    renderSession(onExpandWithoutPane);

    const before = filesPressed();
    const opened = press(CMD_SHIFT_F);
    const afterOpen = filesPressed();
    const focusedLabel = document.activeElement?.getAttribute("aria-label");
    const closed = press(CMD_SHIFT_F);

    expect({
      before,
      afterOpen,
      focusedLabel,
      afterClose: filesPressed(),
      paneAfterClose: screen.queryByRole("region", { name: "Files" }),
      prevented: [opened.defaultPrevented, closed.defaultPrevented],
      chromeToggles: onExpandWithoutPane.mock.calls.length,
    }).toStrictEqual({
      before: "false",
      afterOpen: "true",
      focusedLabel: "Filter files",
      afterClose: "false",
      paneAfterClose: null,
      prevented: [true, true],
      chromeToggles: 0,
    });
  });

  it("⌃⇧F is not the Files shortcut on mac", () => {
    registerFilesPane();
    renderSession();

    const event = press(CTRL_SHIFT_F);

    expect({ pressed: filesPressed(), prevented: event.defaultPrevented }).toStrictEqual({
      pressed: "false",
      prevented: false,
    });
  });

  it("the titlebar pill toggles the pane and shows a floor count while records are unscanned", () => {
    registerFilesPane();
    render(
      <SettingsProvider>
        <TileHost sessionId="files-pane" onExpandWithoutPane={() => {}}>
          <FilesPaneToggle count={12} unscannedRecordCount={3200} />
        </TileHost>
      </SettingsProvider>,
    );

    const pill = screen.getByRole("button", { name: "Files 12+" });
    fireEvent.click(pill);

    expect({
      title: pill.getAttribute("title"),
      keyshortcuts: pill.getAttribute("aria-keyshortcuts"),
      pressed: pill.getAttribute("aria-pressed"),
      paneOpen: screen.queryByRole("region", { name: "Files" }) !== null,
    }).toStrictEqual({
      title:
        "Counted from the loaded messages only — 3200 earlier records have not been scanned. Load earlier messages to include them.",
      keyshortcuts: "Shift+Meta+f",
      pressed: "true",
      paneOpen: true,
    });
  });
});

describe("Files pane header", () => {
  it("lists the header controls in upstream order", () => {
    registerFilesPane();
    renderSession();
    press(CMD_SHIFT_F);

    const header = filesPane().querySelector("[data-files-header]");
    expect({
      labels: [...(header?.querySelectorAll("button") ?? [])].map((button) =>
        button.getAttribute("aria-label"),
      ),
      title: header?.querySelector("[data-pane-title]")?.textContent,
    }).toStrictEqual({
      labels: ["Hide file tree", "Move", "Search files", "Files settings", "Expand", "Close"],
      title: "Files",
    });
  });

  it("the tree toggle hides the tree and switches the empty state copy", () => {
    registerFilesPane();
    renderSession();
    press(CMD_SHIFT_F);

    const pane = filesPane();
    const toggle = within(pane).getByRole("button", { name: "Hide file tree" });
    const before = {
      pressed: toggle.getAttribute("aria-pressed"),
      keyshortcuts: toggle.getAttribute("aria-keyshortcuts"),
      tree: pane.querySelector("[data-files-tree]") !== null,
      detail:
        within(pane).queryByText(
          "Pick a file in the tree, or click a file path in the conversation.",
        ) !== null,
    };
    fireEvent.click(toggle);
    const after = {
      pressed: within(pane)
        .getByRole("button", { name: "Show file tree" })
        .getAttribute("aria-pressed"),
      tree: pane.querySelector("[data-files-tree]") !== null,
      detail:
        within(pane).queryByText("Click a file path in the conversation to open it.") !== null,
    };

    expect({ before, after }).toStrictEqual({
      before: { pressed: "true", keyshortcuts: "Control+Shift+y", tree: true, detail: true },
      after: { pressed: "false", tree: false, detail: true },
    });
  });

  it("⌃⇧Y toggles the file tree while the Files pane is focused", () => {
    registerFilesPane();
    renderSession();
    press(CMD_SHIFT_F);

    const event = press(CTRL_SHIFT_Y);

    expect({
      prevented: event.defaultPrevented,
      toggle: within(filesPane())
        .getByRole("button", { name: /file tree$/ })
        .getAttribute("aria-label"),
    }).toStrictEqual({ prevented: true, toggle: "Show file tree" });
  });

  it("Files settings offers Hide ignored files, off by default and persisted", async () => {
    registerFilesPane();
    renderSession();
    press(CMD_SHIFT_F);

    fireEvent.click(within(filesPane()).getByRole("button", { name: "Files settings" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const before = [
      ...screen.getByRole("menu").querySelectorAll<HTMLElement>("[role^=menuitem]"),
    ].map((item) => [item.textContent ?? "", item.getAttribute("aria-checked")]);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Hide ignored files" }));

    expect({
      before,
      stored: localStorage.getItem("ccp-files-hide-ignored"),
      checked: screen
        .getByRole("menuitemcheckbox", { name: "Hide ignored files" })
        .getAttribute("aria-checked"),
    }).toStrictEqual({
      before: [
        ["Show file tree⌃Control⇧ShiftY", "true"],
        ["Hide ignored files", "false"],
      ],
      stored: "true",
      checked: "true",
    });
  });

  it("Search files reveals a hidden tree and focuses the filter", async () => {
    registerFilesPane();
    renderSession();
    press(CMD_SHIFT_F);
    const pane = filesPane();
    fireEvent.click(within(pane).getByRole("button", { name: "Hide file tree" }));
    (document.activeElement as HTMLElement | null)?.blur();

    fireEvent.click(within(pane).getByRole("button", { name: "Search files" }));

    await waitFor(() =>
      expect({
        tree: pane.querySelector("[data-files-tree]") !== null,
        focused: document.activeElement?.getAttribute("aria-label"),
      }).toStrictEqual({ tree: true, focused: "Filter files" }),
    );
  });
});

describe("Session files list", () => {
  function openPane(sessionFiles: SessionFiles = SESSION_FILES, unscanned = 0): HTMLElement {
    registerFilesPane(sessionFiles, unscanned);
    renderSession();
    press(CMD_SHIFT_F);
    return filesPane();
  }

  it("shows absolute counts while filtering files by selected source", () => {
    const pane = openPane();

    fireEvent.click(within(pane).getByRole("checkbox", { name: "Read (2)" }));

    expect({
      visiblePaths: visiblePaths(),
      sourceLabels: within(pane)
        .getAllByRole("checkbox")
        .map((element) => element.parentElement?.textContent),
    }).toStrictEqual({
      visiblePaths: ["~/example/agent.ts", "~/notes/user.md"],
      sourceLabels: [
        "User message (1)",
        "Agent message (1)",
        "Read (2)",
        "Edit/Write (0)",
        "Bash (0)",
        "Grep/Glob (0)",
        "Thinking (0)",
        "Other (0)",
      ],
    });
  });

  it("reports source counts as floors when the transcript window hides earlier records", () => {
    const pane = openPane(SESSION_FILES, 3200);

    expect({
      count: within(pane).getByLabelText("3 items in the loaded messages").textContent,
      note: within(pane).getByRole("note").textContent,
    }).toStrictEqual({
      count: "3+",
      note: "Counted from the loaded messages only — 3200 earlier records have not been scanned. Load earlier messages to include them.",
    });
  });

  it("unselects every source, removes every row, and persists the selection", async () => {
    const pane = openPane();

    fireEvent.click(within(pane).getByRole("button", { name: "Unselect all" }));

    expect({
      checked: within(pane)
        .getAllByRole("checkbox")
        .map((checkbox) => (checkbox as HTMLInputElement).checked),
      visiblePaths: visiblePaths(),
      emptyMessage: within(pane).getByText("No files match the selected sources.").textContent,
    }).toStrictEqual({
      checked: [false, false, false, false, false, false, false, false],
      visiblePaths: [],
      emptyMessage: "No files match the selected sources.",
    });
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
    const pane = openPane();

    await waitFor(() =>
      expect(
        within(pane)
          .getAllByRole("checkbox")
          .map((checkbox) => (checkbox as HTMLInputElement).checked),
      ).toStrictEqual([false, true, false, true, false, true, false, true]),
    );
  });

  it("ignores a malformed or incomplete stored source selection", async () => {
    localStorage.setItem(
      FILE_SOURCE_SELECTION_STORAGE_KEY,
      JSON.stringify({ userMessage: false, read: "yes" }),
    );
    const pane = openPane();

    await waitFor(() =>
      expect(localStorage.getItem(FILE_SOURCE_SELECTION_STORAGE_KEY)).toBe(
        JSON.stringify(DEFAULT_FILE_SOURCE_SELECTION),
      ),
    );
    expect(
      within(pane)
        .getAllByRole("checkbox")
        .map((checkbox) => (checkbox as HTMLInputElement).checked),
    ).toStrictEqual([true, true, true, true, true, true, true, true]);
  });

  it("filters canonical paths case-insensitively without matching absolute paths", () => {
    const pane = openPane();
    const search = within(pane).getByRole("searchbox", { name: "Filter files" });

    fireEvent.change(search, { target: { value: "USER.MD" } });
    const upper = visiblePaths();
    fireEvent.change(search, { target: { value: "alice" } });

    expect({
      placeholder: search.getAttribute("placeholder"),
      upper,
      alice: visiblePaths(),
      emptyMessage: within(pane).getByText("No files match “alice”.").textContent,
    }).toStrictEqual({
      placeholder: "Search files…",
      upper: ["~/notes/user.md"],
      alice: [],
      emptyMessage: "No files match “alice”.",
    });
  });

  it("left-truncates labels with an ellipsis and exposes the full path", () => {
    const pane = openPane();

    const label = within(pane).getByText("~/example/agent.ts");
    const pathContainer = label.parentElement;
    expect({
      labelElement: label.tagName,
      direction: pathContainer?.getAttribute("dir"),
      title: pathContainer?.getAttribute("title"),
      links: within(pane).queryAllByRole("link").length,
    }).toStrictEqual({
      labelElement: "BDI",
      direction: "rtl",
      title: "~/example/agent.ts",
      links: 0,
    });
  });

  it("copies the absolute path and confirms only a successful write", async () => {
    vi.mocked(writeClipboardText).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const pane = openPane();
    const copyButton = within(pane).getByRole("button", { name: "Copy ~/example/agent.ts" });

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
