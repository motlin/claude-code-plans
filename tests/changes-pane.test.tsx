// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  ChangesPaneView,
  isLargeDiff,
  LARGE_DIFF_MAX_FILES,
  LARGE_DIFF_MAX_LINES,
} from "../src/components/changes/changes-pane";
import type {
  SessionDiffFile,
  SessionDiffResponse,
  SessionDiffScopesResponse,
} from "../src/lib/api/session-diff";

const GREET_PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,4 @@
 export function greet(name: string) {
-  return "hi " + name;
+  const greeting = "hello";
+  return greeting + " " + name;
 }
`;

const GREET_FILE: SessionDiffFile = {
  path: "src/greet.ts",
  status: "modified",
  additions: 2,
  deletions: 1,
  binary: false,
  patchLineCount: 10,
  patch: GREET_PATCH,
};

const LOGO_FILE: SessionDiffFile = {
  path: "assets/logo.png",
  status: "added",
  additions: 0,
  deletions: 0,
  binary: true,
  patchLineCount: 0,
  patch: null,
};

const SCOPES: SessionDiffScopesResponse = {
  kind: "git",
  base: "main",
  baseRef: "origin/main",
  mergeBase: "abc1234",
  head: null,
  uncommittedAvailable: true,
  commits: [],
  totalCommits: 0,
};

function diffOf(files: SessionDiffFile[]): SessionDiffResponse {
  return {
    scope: "branch",
    source: "git",
    stats: {
      files: files.length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    },
    files,
  };
}

function renderPane(files: SessionDiffFile[]) {
  return render(
    <ChangesPaneView
      diff={diffOf(files)}
      scopes={SCOPES}
      controls={<button type="button">Close</button>}
      goToFile={<button type="button">Go to file</button>}
      onRefresh={() => {}}
    />,
  );
}

class FakeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeObserver);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function headerButton(path: string): HTMLElement {
  const header = document.querySelector(`[data-diff-file-header="${path}"] button[aria-expanded]`);
  if (!(header instanceof HTMLElement)) throw new Error(`No header for ${path}`);
  return header;
}

async function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: "Changes settings" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("isLargeDiff", () => {
  it("is large past 100 files or 10k changed lines", () => {
    const manyFiles = Array.from({ length: LARGE_DIFF_MAX_FILES + 1 }, (_, index) => ({
      ...GREET_FILE,
      path: `f${index}.ts`,
    }));
    expect({
      maxFiles: LARGE_DIFF_MAX_FILES,
      maxLines: LARGE_DIFF_MAX_LINES,
      small: isLargeDiff([GREET_FILE]),
      atFileLimit: isLargeDiff(manyFiles.slice(0, LARGE_DIFF_MAX_FILES)),
      overFileLimit: isLargeDiff(manyFiles),
      atLineLimit: isLargeDiff([{ ...GREET_FILE, additions: 6000, deletions: 4000 }]),
      overLineLimit: isLargeDiff([{ ...GREET_FILE, additions: 6000, deletions: 4001 }]),
    }).toEqual({
      maxFiles: 100,
      maxLines: 10_000,
      small: false,
      atFileLimit: false,
      overFileLimit: true,
      atLineLimit: false,
      overLineLimit: true,
    });
  });
});

describe("ChangesPaneView", () => {
  it("shows the empty copy and hides the file controls when there are no changes", () => {
    renderPane([]);

    expect({
      empty: screen.getByText("No changes to show").tagName,
      scope: screen.getByRole("button", { name: "Diff scope: main → working tree" }).textContent,
      showFiles: screen.queryByRole("button", { name: "Show files" }),
      goToFile: screen.queryByRole("button", { name: "Go to file" }),
      settings: screen.getByRole("button", { name: "Changes settings" }).tagName,
      close: screen.getByRole("button", { name: "Close" }).tagName,
    }).toEqual({
      empty: "P",
      scope: "mainworking tree",
      showFiles: null,
      goToFile: null,
      settings: "BUTTON",
      close: "BUTTON",
    });
  });

  it("shows the file controls when there are changes", () => {
    renderPane([GREET_FILE]);

    expect({
      showFiles: screen.getByRole("button", { name: "Show files" }).getAttribute("aria-pressed"),
      goToFile: screen.getByRole("button", { name: "Go to file" }).tagName,
      empty: screen.queryByText("No changes to show"),
    }).toEqual({ showFiles: "false", goToFile: "BUTTON", empty: null });
  });

  it("toggles a file's aria-expanded when its header is clicked", async () => {
    renderPane([GREET_FILE]);

    await waitFor(() => {
      expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("true");
    });
    fireEvent.click(headerButton("src/greet.ts"));
    expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(headerButton("src/greet.ts"));
    expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("true");
  });

  it("flips the Show files toggle label when pressed", () => {
    renderPane([GREET_FILE]);

    fireEvent.click(screen.getByRole("button", { name: "Show files" }));
    expect(screen.getByRole("button", { name: "Hide files" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("counts files whose diff content is unavailable", () => {
    renderPane([GREET_FILE, LOGO_FILE]);

    expect(screen.getByText("Diff content unavailable for 1 file.").tagName).toBe("P");
  });

  it("collapses every file, shows the banner and disables Expand all with a tooltip when large", async () => {
    renderPane([{ ...GREET_FILE, additions: 10_001 }]);

    await waitFor(() => {
      expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("false");
    });
    expect(
      screen.getByText("Files are collapsed for large diffs. Select a file to expand it.").tagName,
    ).toBe("P");

    await openSettings();
    const expandAll = screen.getByRole("menuitem", { name: "Expand all files" });
    expect({
      disabled: expandAll.getAttribute("aria-disabled"),
      collapseDisabled: screen
        .getByRole("menuitem", { name: "Collapse all files" })
        .getAttribute("aria-disabled"),
    }).toEqual({ disabled: "true", collapseDisabled: null });

    vi.useFakeTimers();
    fireEvent.pointerEnter(expandAll.parentElement ?? expandAll);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("tooltip").textContent).toBe(
      "This diff is too large to expand at once. Select a file to expand it.",
    );
  });

  it("collapses and expands every file from the settings menu", async () => {
    renderPane([GREET_FILE]);
    await waitFor(() => {
      expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("true");
    });

    await openSettings();
    fireEvent.click(screen.getByRole("menuitem", { name: "Collapse all files" }));
    expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("false");

    await openSettings();
    fireEvent.click(screen.getByRole("menuitem", { name: "Expand all files" }));
    expect(headerButton("src/greet.ts").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("ChangesPaneView file list", () => {
  const COMMIT = {
    sha: "07bc05d1111111111111111111111111111111111",
    shortSha: "07bc05d",
    subject: "Fetch logs",
    author: "Craig",
    date: "2026-09-14T20:29:26.000Z",
  };

  it("shows the Changed files tree and commit list, marking the selected file active", () => {
    Element.prototype.scrollIntoView = vi.fn();
    const onSelectScope = vi.fn();
    render(
      <ChangesPaneView
        diff={diffOf([GREET_FILE, LOGO_FILE])}
        scopes={{ ...SCOPES, commits: [COMMIT], totalCommits: 1 }}
        controls={null}
        onRefresh={() => {}}
        scope="branch"
        onSelectScope={onSelectScope}
      />,
    );
    expect(screen.queryByRole("tree", { name: "Changed files" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show files" }));
    fireEvent.click(screen.getByRole("treeitem", { name: /^greet\.ts/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Fetch logs/ }));

    expect({
      rows: screen
        .getAllByRole("treeitem")
        .map((row) => [row.textContent, row.getAttribute("aria-current")]),
      selectedScopes: onSelectScope.mock.calls,
    }).toEqual({
      rows: [
        ["assets", null],
        ["logo.png+0−0", null],
        ["src", null],
        ["greet.ts+2−1", "true"],
      ],
      selectedScopes: [["commit:07bc05d1111111111111111111111111111111111"]],
    });
  });
});
