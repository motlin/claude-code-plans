// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { registerPane } from "../src/components/panes/pane-registry";
import { TileHost } from "../src/components/panes/tile-host";
import { SessionChat } from "../src/components/session-chat";
import { SettingsProvider } from "../src/components/settings-provider";
import { TurnChangesCard } from "../src/components/turn-changes-card";
import { fileViewerPath } from "../src/lib/api/file";
import { CHANGES_SCOPE_REQUEST_EVENT } from "../src/lib/changes-scope-request";
import { loadChangesScope } from "../src/lib/pane-layout";
import { processTranscript } from "../src/lib/transcript";
import { aggregateTurnEdits, collectTurnChanges, type TurnChanges } from "../src/lib/turn-changes";
import { installLocalStorage } from "./fake-storage";

vi.mock("../src/lib/hmr-persist", () => ({
  hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
  useClaudeEvents: () => ({ failedTools: new Map() }),
}));

class FakeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  installLocalStorage();
  vi.stubGlobal("ResizeObserver", FakeObserver);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("aggregateTurnEdits", () => {
  it("sums each file's stats across calls in first-edit order, skipping failed and non-edit calls", () => {
    const summary = aggregateTurnEdits([
      {
        name: "Edit",
        input: { file_path: "/repo/src/b.ts", old_string: "one\ntwo", new_string: "one\n2" },
      },
      { name: "Write", input: { file_path: "/repo/src/a.ts", content: "x\ny\nz" } },
      { name: "Read", input: { file_path: "/repo/src/c.ts" } },
      {
        name: "Edit",
        input: { file_path: "/repo/src/b.ts", old_string: "three", new_string: "3\n4" },
      },
      {
        name: "Edit",
        input: { file_path: "/repo/src/d.ts", old_string: "a", new_string: "b" },
        isError: true,
      },
      {
        name: "MultiEdit",
        input: {
          file_path: "/repo/src/a.ts",
          edits: [
            { old_string: "x", new_string: "X" },
            { old_string: "y\nz", new_string: "" },
          ],
        },
      },
      {
        name: "NotebookEdit",
        input: { notebook_path: "/repo/nb.ipynb", new_source: "print(1)\nprint(2)" },
      },
    ]);

    expect(summary).toStrictEqual({
      files: [
        { path: "/repo/src/b.ts", added: 3, removed: 2 },
        { path: "/repo/src/a.ts", added: 4, removed: 3 },
        { path: "/repo/nb.ipynb", added: 2, removed: 0 },
      ],
      added: 9,
      removed: 5,
    });
  });
});

const EDIT_RECORDS = [
  { type: "user", uuid: "u-1", message: { role: "user", content: "Fabricated request" } },
  {
    type: "assistant",
    uuid: "a-1",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "Edit",
          input: { file_path: "/repo/src/cache.ts", old_string: "old", new_string: "new\nline" },
        },
      ],
    },
  },
  {
    type: "user",
    uuid: "r-1",
    sourceToolAssistantUUID: "a-1",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok" }],
    },
  },
  {
    type: "assistant",
    uuid: "a-2",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool-2",
          name: "Write",
          input: { file_path: "/repo/src/index.ts", content: "export {};" },
        },
      ],
    },
  },
  {
    type: "user",
    uuid: "r-2",
    sourceToolAssistantUUID: "a-2",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tool-2", content: "ok" }],
    },
  },
  {
    type: "assistant",
    uuid: "a-3",
    message: { role: "assistant", content: [{ type: "text", text: "Fabricated final answer" }] },
  },
  { type: "user", uuid: "u-2", message: { role: "user", content: "Fabricated follow-up" } },
  {
    type: "assistant",
    uuid: "a-4",
    message: { role: "assistant", content: [{ type: "text", text: "Fabricated reply" }] },
  },
];

describe("collectTurnChanges", () => {
  it("anchors each editing turn on its last assistant text and skips turns without edits", () => {
    const { lines, toolResultMap } = processTranscript(EDIT_RECORDS, 0);
    const changes = collectTurnChanges(lines, toolResultMap);

    expect([...changes.entries()]).toStrictEqual([
      [
        5,
        {
          turnUuid: "u-1",
          anchorLineIndex: 5,
          files: [
            { path: "/repo/src/cache.ts", added: 2, removed: 1 },
            { path: "/repo/src/index.ts", added: 1, removed: 0 },
          ],
          added: 3,
          removed: 1,
        },
      ],
    ]);
  });
});

describe("SessionChat end-of-turn card", () => {
  it("renders the card inside the turn's final text entry", () => {
    const { lines, toolResultMap } = processTranscript(EDIT_RECORDS, 0);
    const { container } = render(
      <SettingsProvider>
        <SessionChat
          sessionId="test-session"
          lines={lines}
          toolResultMap={toolResultMap}
          shouldScrollToEnd={false}
        />
      </SettingsProvider>,
    );

    const cards = [...container.querySelectorAll("[data-turn-changes-card]")].map((card) => ({
      entry: card.closest("[data-record-index]")?.getAttribute("data-record-index"),
      text: card.textContent,
    }));
    expect(cards).toStrictEqual([
      { entry: "5", text: "Edited 2 files+3-1Undocache.ts+2-1index.ts+1-0" },
    ]);
  });
});

function changesWith(fileCount: number): TurnChanges {
  const files = Array.from({ length: fileCount }, (_, index) => ({
    path: `/repo/src/file-${index + 1}.ts`,
    added: index + 1,
    removed: 1,
  }));
  return {
    turnUuid: "u-1",
    anchorLineIndex: 5,
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: fileCount,
  };
}

function fileRowNames(): string[] {
  return screen.getAllByRole("link").map((link) => link.textContent ?? "");
}

describe("TurnChangesCard", () => {
  it("caps the list at four rows and expands with Show N more", () => {
    render(<TurnChangesCard sessionId="test-session" changes={changesWith(6)} />);
    const before = fileRowNames();
    const more = screen.getByRole("button", { name: "Show 2 more" });
    const expandedBefore = more.getAttribute("aria-expanded");
    fireEvent.click(more);

    expect({
      before,
      expandedBefore,
      after: fileRowNames(),
      moreAfter: screen.queryByRole("button", { name: /Show \d+ more/ }),
    }).toStrictEqual({
      before: ["file-1.ts+1-1", "file-2.ts+2-1", "file-3.ts+3-1", "file-4.ts+4-1"],
      expandedBefore: "false",
      after: [
        "file-1.ts+1-1",
        "file-2.ts+2-1",
        "file-3.ts+3-1",
        "file-4.ts+4-1",
        "file-5.ts+5-1",
        "file-6.ts+6-1",
      ],
      moreAfter: null,
    });
  });

  it("names a single file in the singular and shows no Show more", () => {
    render(<TurnChangesCard sessionId="test-session" changes={changesWith(1)} />);
    expect({
      header: screen.getByText("Edited 1 file").textContent,
      more: screen.queryByRole("button", { name: /Show \d+ more/ }),
    }).toStrictEqual({ header: "Edited 1 file", more: null });
  });

  it("links each file row to the file viewer", () => {
    render(<TurnChangesCard sessionId="test-session" changes={changesWith(2)} />);
    expect(
      screen.getAllByRole("link").map((link) => ({
        href: link.getAttribute("href"),
        title: link.getAttribute("title"),
      })),
    ).toStrictEqual([
      { href: fileViewerPath("/repo/src/file-1.ts"), title: "/repo/src/file-1.ts" },
      { href: fileViewerPath("/repo/src/file-2.ts"), title: "/repo/src/file-2.ts" },
    ]);
  });

  it("opens the Changes pane scoped to the turn from the header", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 1200, height: 800 }),
    );
    const unregister = registerPane("changes", {
      title: "Changes",
      render: () => <div data-testid="changes-pane">Changes pane</div>,
    });
    const requests: unknown[] = [];
    const listener = (event: Event) => requests.push((event as CustomEvent).detail);
    window.addEventListener(CHANGES_SCOPE_REQUEST_EVENT, listener);
    try {
      render(
        <SettingsProvider>
          <TileHost sessionId="turn-card-session" onExpandWithoutPane={() => {}}>
            <TurnChangesCard sessionId="turn-card-session" changes={changesWith(2)} />
          </TileHost>
        </SettingsProvider>,
      );
      const before = screen.queryByTestId("changes-pane");
      const card = screen.getByRole("list", { name: "Edited 2 files" }).parentElement!;
      act(() => {
        fireEvent.click(within(card).getByRole("button", { name: /^Edited 2 files/ }));
      });

      expect({
        before,
        opened: screen.queryByTestId("changes-pane")?.textContent,
        scope: loadChangesScope("turn-card-session"),
        requests,
      }).toStrictEqual({
        before: null,
        opened: "Changes pane",
        scope: "turn:u-1",
        requests: [{ sessionId: "turn-card-session", scope: "turn:u-1" }],
      });
    } finally {
      window.removeEventListener(CHANGES_SCOPE_REQUEST_EVENT, listener);
      unregister();
    }
  });

  it("renders a static header outside a pane host", () => {
    render(<TurnChangesCard sessionId="test-session" changes={changesWith(2)} />);
    expect(screen.queryByRole("button", { name: /^Edited/ })).toBeNull();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(responses: Response[]): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      const next = responses.shift();
      if (next === undefined) throw new Error(`Unexpected fetch ${url}`);
      return next;
    }),
  );
  return calls;
}

const READY_PREVIEW = {
  files: [
    { path: "/repo/src/file-1.ts", status: "modified", state: "ready" },
    { path: "/repo/src/file-2.ts", status: "added", state: "ready" },
  ],
};

describe("TurnChangesCard Undo", () => {
  it("lists the files in a confirm dialog and reverts them on confirm", async () => {
    const calls = stubFetch([
      jsonResponse(READY_PREVIEW),
      jsonResponse({ reverted: ["/repo/src/file-1.ts", "/repo/src/file-2.ts"] }),
    ]);
    render(<TurnChangesCard sessionId="s-1" changes={changesWith(2)} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    const dialog = await screen.findByRole("alertdialog");
    const listed = within(dialog)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo changes" }));
    const status = await screen.findByText("Reverted 2 files");

    expect({ title: within(dialog).getByRole("heading").textContent, listed, calls }).toStrictEqual(
      {
        title: "Undo changes from this turn?",
        listed: ["file-1.ts", "file-2.ts"],
        calls: [
          { url: "/api/sessions/s-1/turn-undo?turn=u-1", method: "GET", body: null },
          {
            url: "/api/sessions/s-1/turn-undo",
            method: "POST",
            body: { turn: "u-1", confirm: true },
          },
        ],
      },
    );
    expect(status.textContent).toBe("Reverted 2 files");
  });

  it("writes nothing when the dialog is cancelled", async () => {
    const calls = stubFetch([jsonResponse(READY_PREVIEW)]);
    render(<TurnChangesCard sessionId="s-1" changes={changesWith(2)} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(calls.map((call) => call.method)).toStrictEqual(["GET"]);
  });

  it("refuses without a dialog when files changed since the turn", async () => {
    const calls = stubFetch([
      jsonResponse({
        files: [
          { path: "/repo/src/file-1.ts", status: "modified", state: "conflict" },
          { path: "/repo/src/file-2.ts", status: "added", state: "ready" },
        ],
      }),
    ]);
    render(<TurnChangesCard sessionId="s-1" changes={changesWith(2)} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    const alert = await screen.findByRole("alert");

    expect({
      alert: alert.textContent,
      dialog: screen.queryByRole("alertdialog"),
      methods: calls.map((call) => call.method),
    }).toStrictEqual({
      alert: "Can't undo: file-1.ts changed since this turn.",
      dialog: null,
      methods: ["GET"],
    });
  });
});
