// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ChangesPaneView } from "../src/components/changes/changes-pane";
import { Composer } from "../src/components/composer";
import { SettingsProvider } from "../src/components/settings-provider";
import { ToastProvider } from "../src/components/toast";
import type { SessionDiffResponse } from "../src/lib/api/session-diff";
import { onAttachContextRequest } from "../src/lib/context-attach";
import { clearDiffComments, getDiffComments, openDiffCommentDraft } from "../src/lib/diff-comments";
import { installLocalStorage } from "./fake-storage";

vi.mock("../src/lib/hmr-persist", () => ({
  hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));

const SESSION = "session-alice";

const PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,5 @@
 export function greet(name: string) {
-  return "hi " + name;
+  const greeting = "hello";
+  return greeting + " " + name;
 }
+export const loud = (name: string) => greet(name).toUpperCase();
`;

const DIFF: SessionDiffResponse = {
  scope: "uncommitted",
  source: "git",
  stats: { files: 1, additions: 3, deletions: 1 },
  files: [
    {
      path: "src/greet.ts",
      status: "modified",
      additions: 3,
      deletions: 1,
      binary: false,
      patchLineCount: 10,
      patch: PATCH,
    },
  ],
};

class SilentObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  installLocalStorage();
  vi.stubGlobal("ResizeObserver", SilentObserver);
  vi.stubGlobal("IntersectionObserver", SilentObserver);
});

afterEach(() => {
  cleanup();
  clearDiffComments(SESSION);
  vi.unstubAllGlobals();
});

function renderPane(onSend: (prompt: string) => void = () => {}) {
  return render(
    <SettingsProvider>
      <ToastProvider>
        <ChangesPaneView
          diff={DIFF}
          scopes={undefined}
          controls={null}
          onRefresh={() => {}}
          scope="uncommitted"
          sessionId={SESSION}
        />
        <Composer variant="session" draftKey={SESSION} onSend={onSend} />
      </ToastProvider>
    </SettingsProvider>,
  );
}

function commentCard(container: HTMLElement, slot: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[slot="${slot}"] [data-line-comment]`);
}

describe("Changes pane line comments", () => {
  it("opens a comment card under the line and removes it on Escape while empty", () => {
    const { container } = renderPane();
    act(() => {
      openDiffCommentDraft(SESSION, { path: "src/greet.ts", side: "additions", line: 3 });
    });
    const card = commentCard(container, "annotation-additions-3");
    if (card === null) throw new Error("no comment card");
    const textarea = within(card).getByPlaceholderText("Request changes");
    const opened = {
      label: within(card).getByText("Line 3").textContent,
      saveDisabled: within(card).getByRole<HTMLButtonElement>("button", { name: "Save comment" })
        .disabled,
    };

    fireEvent.keyDown(textarea, { key: "Escape" });

    expect({
      opened,
      card: commentCard(container, "annotation-additions-3"),
      comments: getDiffComments(SESSION),
    }).toStrictEqual({
      opened: { label: "Line 3", saveDisabled: true },
      card: null,
      comments: { drafts: [], queued: [] },
    });
  });

  it("keeps a card with text open on Escape", () => {
    const { container } = renderPane();
    act(() => {
      openDiffCommentDraft(SESSION, { path: "src/greet.ts", side: "additions", line: 3 });
    });
    const card = commentCard(container, "annotation-additions-3");
    if (card === null) throw new Error("no comment card");
    const textarea = within(card).getByPlaceholderText("Request changes");
    fireEvent.change(textarea, { target: { value: "Use a constant" } });
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(commentCard(container, "annotation-additions-3")).not.toBeNull();
  });

  it("queues saved comments as chips and prepends them to the next prompt", () => {
    const onSend = vi.fn<(prompt: string) => void>();
    const { container } = renderPane(onSend);
    act(() => {
      openDiffCommentDraft(SESSION, {
        path: "src/greet.ts",
        side: "additions",
        line: 2,
        endLine: 3,
      });
    });
    const card = commentCard(container, "annotation-additions-3");
    if (card === null) throw new Error("no comment card");
    fireEvent.change(within(card).getByPlaceholderText("Request changes"), {
      target: { value: "Extract a helper" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Save comment" }));

    const chips = screen.getByRole("list", { name: "Queued comments" });
    const queued = {
      chips: within(chips)
        .getAllByRole("listitem")
        .map((chip) => chip.textContent),
      badge: container.querySelector('[slot="annotation-additions-3"] [data-queued-comment]')
        ?.textContent,
      sendEnabled: !screen.getByRole<HTMLButtonElement>("button", { name: "Send" }).disabled,
    };

    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.change(prompt, { target: { value: "Please address these" } });
    fireEvent.keyDown(prompt, { key: "Enter" });

    expect({
      queued,
      sent: onSend.mock.calls,
      chipsAfter: screen.queryByRole("list", { name: "Queued comments" }),
      comments: getDiffComments(SESSION),
    }).toStrictEqual({
      queued: {
        chips: ["greet.ts:2-3Extract a helper"],
        badge: "Lines 2–3QueuedExtract a helper",
        sendEnabled: true,
      },
      sent: [["src/greet.ts:2-3 — Extract a helper\n\nPlease address these"]],
      chipsAfter: null,
      comments: { drafts: [], queued: [] },
    });
  });

  it("removes a queued comment from its chip", () => {
    renderPane();
    act(() => {
      openDiffCommentDraft(SESSION, { path: "src/greet.ts", side: "additions", line: 5 });
    });
    const card = document.querySelector<HTMLElement>(
      '[slot="annotation-additions-5"] [data-line-comment]',
    );
    if (card === null) throw new Error("no comment card");
    fireEvent.change(within(card).getByPlaceholderText("Request changes"), {
      target: { value: "Rename" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Save comment" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove comment on greet.ts:5" }));

    expect({
      chips: screen.queryByRole("list", { name: "Queued comments" }),
      comments: getDiffComments(SESSION),
    }).toStrictEqual({ chips: null, comments: { drafts: [], queued: [] } });
  });
});

describe("Changes pane right-click menu", () => {
  async function rightClickLine(container: HTMLElement, line: number): Promise<void> {
    const row = await waitFor(() => {
      const root = container.querySelector("diffs-container")?.shadowRoot;
      const found = root?.querySelector(`[data-line-type="change-addition"][data-line="${line}"]`);
      if (!found) throw new Error("diff not rendered yet");
      return found;
    });
    fireEvent.contextMenu(row);
  }

  it("offers Attach as context, Request changes and Copy", async () => {
    const { container } = renderPane();
    await rightClickLine(container, 3);
    const items = await screen.findAllByRole("menuitem");

    expect(
      items.map((item) => [
        item.textContent?.replace(/(⌘C|Ctrl\+C)$/, ""),
        item.getAttribute("aria-keyshortcuts"),
      ]),
    ).toStrictEqual([
      ["Attach as context", null],
      ["Request changes", null],
      ["Copy", "Control+c"],
    ]);
  });

  it("attaches the clicked line as @path#L with its code fenced", async () => {
    const snippets: string[] = [];
    const stop = onAttachContextRequest(SESSION, (snippet) => snippets.push(snippet));
    const { container } = renderPane();
    await rightClickLine(container, 3);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Attach as context/ }));
    stop();

    expect(snippets).toStrictEqual([
      '@src/greet.ts#L3\n```typescript\n  return greeting + " " + name;\n```',
    ]);
  });

  it("opens a comment card on the clicked line from Request changes", async () => {
    const { container } = renderPane();
    await rightClickLine(container, 3);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Request changes/ }));

    expect(
      getDiffComments(SESSION).drafts.map(({ path, side, line }) => ({ path, side, line })),
    ).toStrictEqual([{ path: "src/greet.ts", side: "additions", line: 3 }]);
    expect(commentCard(container, "annotation-additions-3")).not.toBeNull();
  });
});
