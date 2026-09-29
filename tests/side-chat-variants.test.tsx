// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

import { TileHost } from "../src/components/panes/tile-host";
import { SideChat } from "../src/components/side-chat";
import { ToastProvider } from "../src/components/toast";
import {
  askSideChat,
  getSideChat,
  openSideChat,
  resetSideChatStore,
} from "../src/lib/side-chat-store";

const SESSION_ID = "session-side-chat-variants";

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

function ndjsonResponse(text: string): Response {
  const events = [
    {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text } },
    },
  ];
  return new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson", "X-Process-Id": "proc-1" },
  });
}

function renderInHost() {
  return render(
    <ToastProvider>
      <TileHost sessionId={SESSION_ID}>
        <p>Main chat</p>
        <SideChat sessionId={SESSION_ID} messageCount={7} />
      </TileHost>
    </ToastProvider>,
  );
}

function floatingCard(): HTMLElement | null {
  return document.querySelector<HTMLElement>('aside[aria-label="Side chat"][data-open]');
}

function dockedPane(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-pane-root][data-pane-kind="side-chat"]');
}

/** Where the Q/A history is visible: floating card, docked pane, or neither. */
function snapshot() {
  const floating = floatingCard();
  const docked = dockedPane();
  const surface = floating ?? docked;
  return {
    mode: getSideChat(SESSION_ID).mode,
    floating: floating !== null,
    docked: docked !== null,
    history:
      surface === null
        ? []
        : within(surface)
            .queryAllByRole("listitem")
            .map((item) => item.textContent),
  };
}

async function askOneQuestion() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ndjsonResponse("It loads the config.")),
  );
  await act(() => askSideChat(SESSION_ID, "What does load() do?"));
}

const HISTORY = ["What does load() do?It loads the config.\nCopyBranch"];

beforeEach(() => {
  resetSideChatStore();
  vi.stubGlobal("localStorage", new FakeStorage());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 1200, height: 800 }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SideChat variants", () => {
  it("switches floating → docked → floating while keeping the Q/A history", async () => {
    renderInHost();
    act(() => openSideChat(SESSION_ID));
    await askOneQuestion();
    const floating = snapshot();

    fireEvent.click(screen.getByRole("button", { name: "Dock side chat" }));
    const docked = snapshot();
    const dockedTitle = dockedPane()?.querySelector("h2")?.textContent;

    fireEvent.click(screen.getByRole("button", { name: "Undock side chat" }));
    const refloated = snapshot();

    expect({ floating, docked, dockedTitle, refloated }).toEqual({
      floating: { mode: "floating", floating: true, docked: false, history: HISTORY },
      docked: { mode: "docked", floating: false, docked: true, history: HISTORY },
      dockedTitle: "Side chat",
      refloated: { mode: "floating", floating: true, docked: false, history: HISTORY },
    });
  });

  it("closes the docked pane with Close side chat and reopens docked with ⌘;-style toggles", async () => {
    renderInHost();
    act(() => openSideChat(SESSION_ID));
    await askOneQuestion();
    fireEvent.click(screen.getByRole("button", { name: "Dock side chat" }));

    fireEvent.click(
      within(dockedPane() ?? document.body).getByRole("button", { name: "Close side chat" }),
    );
    const closed = { ...snapshot(), open: getSideChat(SESSION_ID).open };

    act(() => openSideChat(SESSION_ID));
    const reopened = { ...snapshot(), open: getSideChat(SESSION_ID).open };

    expect({ closed, reopened }).toEqual({
      closed: { mode: "docked", floating: false, docked: false, history: [], open: false },
      reopened: { mode: "docked", floating: false, docked: true, history: HISTORY, open: true },
    });
  });

  it("pops out into a new window and returns to floating when that window closes", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const popup = frame.contentWindow;
    if (popup === null) throw new Error("iframe has no window");
    const close = vi.spyOn(popup, "close").mockImplementation(() => undefined);
    const open = vi.fn(() => popup);
    vi.stubGlobal("open", open);

    renderInHost();
    act(() => openSideChat(SESSION_ID));
    await askOneQuestion();
    fireEvent.click(screen.getByRole("button", { name: "Open in new window" }));

    const popped = {
      mode: getSideChat(SESSION_ID).mode,
      floating: floatingCard() !== null,
      docked: dockedPane() !== null,
      history: within(popup.document.body)
        .queryAllByRole("listitem")
        .map((item) => item.textContent),
      openCalls: open.mock.calls.length,
    };

    act(() => {
      popup.dispatchEvent(new Event("pagehide"));
    });
    const returned = snapshot();

    expect({ popped, returned, closed: close.mock.calls.length > 0 }).toEqual({
      popped: { mode: "popout", floating: false, docked: false, history: HISTORY, openCalls: 1 },
      returned: { mode: "floating", floating: true, docked: false, history: HISTORY },
      closed: true,
    });
    frame.remove();
  });

  it("stays floating when the browser blocks the pop-out window", async () => {
    vi.stubGlobal(
      "open",
      vi.fn(() => null),
    );
    renderInHost();
    act(() => openSideChat(SESSION_ID));
    await askOneQuestion();

    fireEvent.click(screen.getByRole("button", { name: "Open in new window" }));

    expect(snapshot()).toEqual({
      mode: "floating",
      floating: true,
      docked: false,
      history: HISTORY,
    });
  });
});
