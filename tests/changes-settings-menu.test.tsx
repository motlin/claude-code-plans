// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ChangesPaneView } from "../src/components/changes/changes-pane";
import { SettingsProvider } from "../src/components/settings-provider";
import type {
  SessionDiffFile,
  SessionDiffResponse,
  SessionDiffScopesResponse,
} from "../src/lib/api/session-diff";
import { installLocalStorage } from "./fake-storage";

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

let paneWidth = 800;

/**
 * Reports `paneWidth` as the pane header's content width as soon as it is
 * observed. The diff library's own observers get nothing, as with FakeObserver.
 */
class WidthObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    if (target.querySelector('[aria-label="Changes settings"]') === null) return;
    this.callback(
      [{ target, contentRect: { width: paneWidth } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
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
  paneWidth = 800;
  installLocalStorage();
  vi.stubGlobal("ResizeObserver", WidthObserver);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPane() {
  return render(
    <SettingsProvider>
      <ChangesPaneView
        diff={diffOf([GREET_FILE])}
        scopes={SCOPES}
        controls={null}
        onRefresh={() => {}}
      />
    </SettingsProvider>,
  );
}

async function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: "Changes settings" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function menuRows(): Array<[string | null, string, string | null]> {
  const menu = screen.getByRole("menu");
  return [...menu.querySelectorAll<HTMLElement>("[role^=menuitem]")].map((item) => [
    item.getAttribute("role"),
    item.textContent ?? "",
    item.getAttribute("aria-checked"),
  ]);
}

describe("Changes settings menu", () => {
  it("lists upstream's items in order with their default checked state", async () => {
    renderPane();
    await openSettings();

    expect(menuRows()).toStrictEqual([
      ["menuitemcheckbox", "Show filesCtrl+Shift+Y", "false"],
      ["menuitemcheckbox", "Group files by folder", "true"],
      ["menuitemcheckbox", "Separate test, build, and generated files", "false"],
      ["menuitem", "Collapse all files", null],
      ["menuitem", "Expand all files", null],
      ["menuitemcheckbox", "Side by side", "false"],
      ["menuitemcheckbox", "Word wrap", "true"],
      ["menuitemcheckbox", "Highlight changed words", "true"],
      ["menuitemcheckbox", "Hide whitespace changes", "false"],
      ["menuitem", "Refresh", null],
    ]);
  });

  it("hides Side by side when the pane is narrower than 560px", async () => {
    paneWidth = 559;
    renderPane();
    await openSettings();

    expect(menuRows().map(([, label]) => label)).toStrictEqual([
      "Show filesCtrl+Shift+Y",
      "Group files by folder",
      "Separate test, build, and generated files",
      "Collapse all files",
      "Expand all files",
      "Word wrap",
      "Highlight changed words",
      "Hide whitespace changes",
      "Refresh",
    ]);
  });

  it("persists every toggle across remounts", async () => {
    const first = renderPane();
    await openSettings();
    for (const label of [
      "Show files",
      "Group files by folder",
      "Separate test, build, and generated files",
      "Side by side",
      "Word wrap",
      "Highlight changed words",
      "Hide whitespace changes",
    ]) {
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: new RegExp(`^${label}`) }));
    }
    first.unmount();

    renderPane();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const showFilesPressed = screen
      .getByRole("button", { name: "Hide files" })
      .getAttribute("aria-pressed");
    await openSettings();

    expect({
      showFilesPressed,
      rows: menuRows(),
      stored: {
        tree: localStorage.getItem("ccp-diff-show-tree"),
        folder: localStorage.getItem("ccp-diff-group-by-folder"),
        kind: localStorage.getItem("ccp-diff-group-by-kind"),
        style: localStorage.getItem("ccp-diff-style"),
        wrap: localStorage.getItem("ccp-diff-word-wrap"),
        words: localStorage.getItem("ccp-diff-word-diff"),
        whitespace: localStorage.getItem("ccp-diff-hide-whitespace"),
      },
    }).toStrictEqual({
      showFilesPressed: "true",
      rows: [
        ["menuitemcheckbox", "Show filesCtrl+Shift+Y", "true"],
        ["menuitemcheckbox", "Group files by folder", "false"],
        ["menuitemcheckbox", "Separate test, build, and generated files", "true"],
        ["menuitem", "Collapse all files", null],
        ["menuitem", "Expand all files", null],
        ["menuitemcheckbox", "Side by side", "true"],
        ["menuitemcheckbox", "Word wrap", "false"],
        ["menuitemcheckbox", "Highlight changed words", "false"],
        ["menuitemcheckbox", "Hide whitespace changes", "true"],
        ["menuitem", "Refresh", null],
      ],
      stored: {
        tree: "true",
        folder: "false",
        kind: "true",
        style: "split",
        wrap: "false",
        words: "false",
        whitespace: "true",
      },
    });
  });

  it("ignores a stored diff style outside the strict schema", async () => {
    localStorage.setItem("ccp-diff-style", "side-by-side");
    renderPane();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await openSettings();

    expect(
      screen.getByRole("menuitemcheckbox", { name: "Side by side" }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("offers only Refresh when there are no changes", async () => {
    render(
      <SettingsProvider>
        <ChangesPaneView diff={diffOf([])} scopes={SCOPES} controls={null} onRefresh={() => {}} />
      </SettingsProvider>,
    );
    await openSettings();

    expect(menuRows()).toStrictEqual([["menuitem", "Refresh", null]]);
  });
});
