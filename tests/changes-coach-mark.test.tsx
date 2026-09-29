// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  ChangesPaneView,
  DIFF_FILE_LIST_COACH_MARK_KEY,
} from "../src/components/changes/changes-pane";
import { SettingsProvider, settingStorageKey } from "../src/components/settings-provider";
import type { SessionDiffFile, SessionDiffResponse } from "../src/lib/api/session-diff";
import { installLocalStorage } from "./fake-storage";

const TITLE_TWO = "Browse all 2 changed files";

function file(path: string): SessionDiffFile {
  return {
    path,
    status: "modified",
    additions: 1,
    deletions: 1,
    binary: false,
    patchLineCount: 6,
    patch: `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-old
+new
`,
  };
}

function diffOf(files: SessionDiffFile[]): SessionDiffResponse {
  return {
    scope: "branch",
    source: "git",
    stats: { files: files.length, additions: files.length, deletions: files.length },
    files,
  };
}

let paneWidth = 800;

/** Reports `paneWidth` as the pane header's content width as soon as it is observed. */
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

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPane(files: SessionDiffFile[]) {
  const result = render(
    <SettingsProvider>
      <ChangesPaneView
        diff={diffOf(files)}
        scopes={undefined}
        controls={null}
        onRefresh={() => {}}
      />
    </SettingsProvider>,
  );
  await tick();
  return result;
}

function coachMark(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: TITLE_TWO });
}

describe("Changes file list coach mark", () => {
  it("shows once while the tree is hidden, fits and there are 2+ files; Show files opens the list", async () => {
    await renderPane([file("src/a.ts"), file("src/b.ts")]);

    const dialog = coachMark();
    if (dialog === null) throw new Error("no coach mark");
    expect({
      variant: dialog.getAttribute("data-variant"),
      text: dialog.textContent,
    }).toStrictEqual({
      variant: "accent",
      text: `${TITLE_TWO}Open the file list to see everything this diff touches and jump between files.Show files`,
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Show files" }));
    await tick();

    expect({
      coachMark: coachMark(),
      seen: localStorage.getItem(DIFF_FILE_LIST_COACH_MARK_KEY),
      tree: localStorage.getItem(settingStorageKey("diffShowTree")),
      toggle: screen.getByRole("button", { name: "Hide files" }).getAttribute("aria-pressed"),
    }).toStrictEqual({ coachMark: null, seen: "true", tree: "true", toggle: "true" });

    fireEvent.click(screen.getByRole("button", { name: "Hide files" }));
    await tick();
    expect(coachMark()).toBeNull();

    cleanup();
    await renderPane([file("src/a.ts"), file("src/b.ts")]);
    expect(coachMark()).toBeNull();
  });

  it("Dismiss marks it seen", async () => {
    await renderPane([file("src/a.ts"), file("src/b.ts")]);
    expect(coachMark()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await tick();
    expect({
      coachMark: coachMark(),
      seen: localStorage.getItem(DIFF_FILE_LIST_COACH_MARK_KEY),
      tree: localStorage.getItem(settingStorageKey("diffShowTree")),
    }).toStrictEqual({ coachMark: null, seen: "true", tree: null });
  });

  it("stays hidden with a single file", async () => {
    await renderPane([file("src/a.ts")]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays hidden when the pane is too narrow for the file list", async () => {
    paneWidth = 300;
    await renderPane([file("src/a.ts"), file("src/b.ts")]);
    expect(coachMark()).toBeNull();
  });

  it("stays hidden when the file list is already shown", async () => {
    localStorage.setItem(settingStorageKey("diffShowTree"), "true");
    await renderPane([file("src/a.ts"), file("src/b.ts")]);
    expect(coachMark()).toBeNull();
  });

  it("stays hidden once seen", async () => {
    localStorage.setItem(DIFF_FILE_LIST_COACH_MARK_KEY, "true");
    await renderPane([file("src/a.ts"), file("src/b.ts")]);
    expect(coachMark()).toBeNull();
  });
});
