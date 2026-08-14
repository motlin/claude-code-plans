// @vitest-environment jsdom

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_FILE_SOURCE_SELECTION,
  FILE_SOURCE_SELECTION_STORAGE_KEY,
  FilesDrawer,
  FilesDrawerToggle,
  OPEN_DRAWER_STORAGE_KEY,
  useExtractedSessionFiles,
  useFilesDrawerState,
  type FileSourceSelection,
} from "../src/components/files-drawer";
import { writeClipboardText } from "../src/lib/clipboard";
import type { FileSourceKey, SessionFiles } from "../src/lib/session-files";
import type { SessionLine } from "../src/lib/transcript";

vi.mock("../src/lib/clipboard", () => ({
  writeClipboardText: vi.fn(),
}));

vi.mock("../src/components/settings-provider", () => ({
  useSettings: () => ({ settings: { showThinking: true, showTools: true } }),
}));

class FakeStorage implements Storage {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function installLocalStorage(): FakeStorage {
  const storage = new FakeStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  return storage;
}

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
      occurrences: [
        {
          source: "tool",
          anchorIndex: 30,
          role: "assistant",
          tool: "Read",
        },
      ],
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

function DrawerHarness({
  sessionFiles = SESSION_FILES,
  unscannedRecordCount = 0,
}: {
  sessionFiles?: SessionFiles;
  unscannedRecordCount?: number;
}) {
  const [sourceSelection, setSourceSelection] = useState<FileSourceSelection>(
    DEFAULT_FILE_SOURCE_SELECTION,
  );

  function setSourceSelected(source: FileSourceKey, selected: boolean): void {
    setSourceSelection((current) => ({ ...current, [source]: selected }));
  }

  function unselectAll(): void {
    setSourceSelection({
      userMessage: false,
      agentMessage: false,
      read: false,
      editWrite: false,
      bash: false,
      grepGlob: false,
      thinking: false,
      other: false,
    });
  }

  return (
    <FilesDrawer
      sessionFiles={sessionFiles}
      unscannedRecordCount={unscannedRecordCount}
      sourceSelection={sourceSelection}
      onSourceSelected={setSourceSelected}
      onUnselectAllSources={unselectAll}
      onClose={vi.fn()}
    />
  );
}

describe("FilesDrawer", () => {
  beforeEach(() => {
    installLocalStorage();
    vi.mocked(writeClipboardText).mockReset();
  });

  it("shows absolute counts while filtering files by selected source", () => {
    render(<DrawerHarness />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Read (2)" }));

    expect({
      visiblePaths: screen.getAllByTitle(/^~\//).map((element) => element.textContent),
      sourceLabels: screen
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
    render(<DrawerHarness unscannedRecordCount={3200} />);

    expect({
      count: screen.getByLabelText("3 items in the loaded messages").textContent,
      note: screen.getByRole("note").textContent,
    }).toStrictEqual({
      count: "3+",
      note: "Counted from the loaded messages only — 3200 earlier records have not been scanned. Load earlier messages to include them.",
    });
  });

  it("unselects every source and removes every row", () => {
    render(<DrawerHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Unselect all" }));

    expect({
      checked: screen
        .getAllByRole("checkbox")
        .map((checkbox) => (checkbox as HTMLInputElement).checked),
      visiblePaths: screen.queryAllByTitle(/^~\//).map((element) => element.textContent),
      emptyMessage: screen.getByText("No files match the selected sources.").textContent,
    }).toStrictEqual({
      checked: [false, false, false, false, false, false, false, false],
      visiblePaths: [],
      emptyMessage: "No files match the selected sources.",
    });
  });

  it("searches canonical paths case-insensitively without matching absolute paths", () => {
    render(<DrawerHarness />);
    const search = screen.getByRole("searchbox", { name: "Filter files" });

    fireEvent.change(search, { target: { value: "USER.MD" } });
    expect(screen.getAllByTitle(/^~\//).map((element) => element.textContent)).toStrictEqual([
      "~/notes/user.md",
    ]);

    fireEvent.change(search, { target: { value: "alice" } });
    expect({
      visiblePaths: screen.queryAllByTitle(/^~\//).map((element) => element.textContent),
      emptyMessage: screen.getByText("No files match “alice”.").textContent,
    }).toStrictEqual({ visiblePaths: [], emptyMessage: "No files match “alice”." });
  });

  it("left-truncates labels with an ellipsis and exposes the full path", () => {
    render(<DrawerHarness />);

    const label = screen.getByText("~/example/agent.ts");
    const pathContainer = label.parentElement;
    expect({
      labelElement: label.tagName,
      direction: pathContainer?.getAttribute("dir"),
      className: pathContainer?.className,
      title: pathContainer?.getAttribute("title"),
      links: screen.queryAllByRole("link").length,
    }).toStrictEqual({
      labelElement: "BDI",
      direction: "rtl",
      className:
        "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left font-mono text-xs text-secondary",
      title: "~/example/agent.ts",
      links: 0,
    });
  });

  it("copies the absolute path and confirms only a successful write", async () => {
    vi.mocked(writeClipboardText).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<DrawerHarness />);
    const copyButton = screen.getByRole("button", { name: "Copy ~/example/agent.ts" });

    fireEvent.click(copyButton);
    await waitFor(() =>
      expect(vi.mocked(writeClipboardText).mock.calls).toStrictEqual([
        ["/home/alice/example/agent.ts"],
      ]),
    );
    expect(copyButton.getAttribute("title")).toBe("Copy absolute path");

    fireEvent.click(copyButton);
    await waitFor(() => expect(copyButton.getAttribute("title")).toBe("Copied"));
    expect(vi.mocked(writeClipboardText).mock.calls).toStrictEqual([
      ["/home/alice/example/agent.ts"],
      ["/home/alice/example/agent.ts"],
    ]);
  });

  it("marks the Files pill as a floor while earlier records are unscanned", () => {
    render(
      <FilesDrawerToggle
        count={12}
        unscannedRecordCount={3200}
        isOpen={false}
        onToggle={vi.fn()}
      />,
    );

    const pill = screen.getByRole("button", { name: "Files 12+" });
    expect(pill.getAttribute("title")).toBe(
      "Counted from the loaded messages only — 3200 earlier records have not been scanned. Load earlier messages to include them.",
    );
  });

  it("disables the Files pill when extraction found no files", () => {
    const onToggle = vi.fn();
    render(<FilesDrawerToggle count={0} isOpen={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "Files 0" }));

    expect({
      disabled: (screen.getByRole("button", { name: "Files 0" }) as HTMLButtonElement).disabled,
      toggleCalls: onToggle.mock.calls,
    }).toStrictEqual({ disabled: true, toggleCalls: [] });
  });
});

describe("files drawer state", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("hydrates validated drawer and source state, then persists only those records", async () => {
    const storedSelection: FileSourceSelection = {
      userMessage: false,
      agentMessage: true,
      read: false,
      editWrite: true,
      bash: false,
      grepGlob: true,
      thinking: false,
      other: true,
    };
    localStorage.setItem(OPEN_DRAWER_STORAGE_KEY, "files");
    localStorage.setItem(FILE_SOURCE_SELECTION_STORAGE_KEY, JSON.stringify(storedSelection));

    const { result } = renderHook(() => useFilesDrawerState());
    await waitFor(() => {
      expect({
        openDrawer: result.current.openDrawer,
        sourceSelection: result.current.sourceSelection,
      }).toStrictEqual({ openDrawer: "files", sourceSelection: storedSelection });
    });

    act(() => {
      result.current.setSourceSelected("bash", true);
      result.current.closeDrawer();
    });
    await waitFor(() => {
      expect((localStorage as FakeStorage).values).toStrictEqual(
        new Map([
          [OPEN_DRAWER_STORAGE_KEY, "none"],
          [
            FILE_SOURCE_SELECTION_STORAGE_KEY,
            JSON.stringify({
              ...storedSelection,
              bash: true,
            }),
          ],
        ]),
      );
    });
  });

  it("rejects malformed or incomplete stored checkbox records", async () => {
    localStorage.setItem(OPEN_DRAWER_STORAGE_KEY, "drawer-example");
    localStorage.setItem(
      FILE_SOURCE_SELECTION_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_FILE_SOURCE_SELECTION, read: "yes" }),
    );

    const { result } = renderHook(() => useFilesDrawerState());

    await waitFor(() => {
      expect({
        openDrawer: result.current.openDrawer,
        sourceSelection: result.current.sourceSelection,
      }).toStrictEqual({
        openDrawer: "none",
        sourceSelection: DEFAULT_FILE_SOURCE_SELECTION,
      });
    });
  });

  it("keeps extraction memoized while unrelated drawer state changes", () => {
    const lines = [
      {
        type: "user",
        lineIndex: 100,
        message: { role: "user", content: "Read /home/alice/example/file.ts" },
      },
    ] satisfies SessionLine[];
    const { result, rerender } = renderHook(
      ({ transcriptLines }) => {
        const drawer = useFilesDrawerState();
        return {
          drawer,
          extracted: useExtractedSessionFiles(transcriptLines, "/home/alice"),
        };
      },
      { initialProps: { transcriptLines: lines } },
    );
    const firstExtraction = result.current.extracted;

    act(() => result.current.drawer.toggleFilesDrawer());
    rerender({ transcriptLines: lines });

    expect({
      sameExtraction: result.current.extracted === firstExtraction,
      extractedCount: result.current.extracted.totalCount,
      drawer: result.current.drawer.openDrawer,
    }).toStrictEqual({ sameExtraction: true, extractedCount: 1, drawer: "files" });
  });
});
