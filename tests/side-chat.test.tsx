// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

import { handleBtwPrompt, SideChat, useSideChatShortcut } from "../src/components/side-chat";
import { ToastProvider } from "../src/components/toast";
import { parseBtwCommand, sideChatBranchTitle } from "../src/lib/side-chat";
import {
  askSideChat,
  getSideChat,
  openSideChat,
  resetSideChatStore,
} from "../src/lib/side-chat-store";

const SESSION_ID = "session-side-chat-100";

function ndjsonResponse(events: unknown[], headers: Record<string, string> = {}): Response {
  const body = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson", "X-Process-Id": "proc-1", ...headers },
  });
}

function textDelta(text: string) {
  return {
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text } },
  };
}

function renderSideChat(messageCount = 12) {
  return render(
    <ToastProvider>
      <SideChat sessionId={SESSION_ID} messageCount={messageCount} />
    </ToastProvider>,
  );
}

function aside(): HTMLElement {
  const element = document.querySelector<HTMLElement>('aside[aria-label="Side chat"]');
  if (element === null) throw new Error("Side chat card is not rendered");
  return element;
}

function ShortcutProbe({ available }: { available: boolean }) {
  useSideChatShortcut(SESSION_ID, available);
  return null;
}

function pressToggle(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: ";",
    code: "Semicolon",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  resetSideChatStore();
  navigate.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("parseBtwCommand", () => {
  it("matches /btw with and without a question", () => {
    expect([
      parseBtwCommand("/btw"),
      parseBtwCommand("/btw   what does foo do?"),
      parseBtwCommand("/btw line one\nline two"),
      parseBtwCommand("/btwx"),
      parseBtwCommand("ask /btw later"),
      parseBtwCommand(" /btw"),
    ]).toEqual([
      { question: "" },
      { question: "what does foo do?" },
      { question: "line one\nline two" },
      null,
      null,
      null,
    ]);
  });
});

describe("sideChatBranchTitle", () => {
  it("prefixes btw: and cuts the question at 59 characters", () => {
    const long = "a".repeat(70);
    expect([sideChatBranchTitle("Why is the build red?"), sideChatBranchTitle(long)]).toEqual([
      "btw: Why is the build red?",
      `btw: ${"a".repeat(59)}…`,
    ]);
  });
});

describe("SideChat", () => {
  it("opens, closes with the X button, and closes on Escape", () => {
    renderSideChat();
    expect(aside().hasAttribute("data-open")).toBe(false);
    expect(aside().hasAttribute("inert")).toBe(true);

    act(() => openSideChat(SESSION_ID));
    expect(aside().hasAttribute("data-open")).toBe(true);
    expect(screen.getByText("Sees 12 messages from main chat · read-only")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close side chat" }));
    expect(aside().hasAttribute("data-open")).toBe(false);

    act(() => openSideChat(SESSION_ID));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Side chat question" }), {
      key: "Escape",
    });
    expect(aside().hasAttribute("data-open")).toBe(false);
  });

  it("switches the placeholder to Follow up… once there is an answer, and Clear resets it", async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        textDelta("It parses "),
        textDelta("the config."),
        { type: "result", subtype: "success", is_error: false, result: "It parses the config." },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderSideChat();
    act(() => openSideChat(SESSION_ID));

    const input = screen.getByRole("textbox", { name: "Side chat question" });
    expect(input.getAttribute("placeholder")).toBe("Ask a quick question…");
    expect(screen.queryByRole("button", { name: "Clear side chat" })).toBeNull();

    fireEvent.change(input, { target: { value: "What does load() do?" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await screen.findByText("It parses the config.");
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/side-chat",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            sessionId: SESSION_ID,
            messages: [],
            question: "What does load() do?",
          }),
        }),
      ],
    ]);
    expect(input.getAttribute("placeholder")).toBe("Follow up…");
    expect(screen.getByRole("button", { name: "Copy answer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Branch to new chat" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear side chat" }));
    expect(screen.queryByText("It parses the config.")).toBeNull();
    expect(input.getAttribute("placeholder")).toBe("Ask a quick question…");
  });

  it("sends earlier Q/A pairs with a follow-up", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ndjsonResponse([textDelta("First answer.")]))
      .mockResolvedValueOnce(ndjsonResponse([textDelta("Second answer.")]));
    vi.stubGlobal("fetch", fetchMock);

    await askSideChat(SESSION_ID, "First?");
    await askSideChat(SESSION_ID, "Second?");

    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toEqual({
      sessionId: SESSION_ID,
      messages: [{ q: "First?", a: "First answer." }],
      question: "Second?",
    });
    expect(
      getSideChat(SESSION_ID).entries.map(({ question, answer, status }) => ({
        question,
        answer,
        status,
      })),
    ).toEqual([
      { question: "First?", answer: "First answer.", status: "done" },
      { question: "Second?", answer: "Second answer.", status: "done" },
    ]);
  });

  it("shows server errors in an alert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Could not determine project directory for session" },
          { status: 404 },
        ),
      ),
    );
    renderSideChat();
    act(() => openSideChat(SESSION_ID));

    await act(() => askSideChat(SESSION_ID, "Anything?"));

    expect(within(aside()).getByRole("alert").textContent).toBe(
      "Could not determine project directory for session",
    );
  });

  it("asks the user to send a main-chat message first when no answer comes back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjsonResponse([])),
    );
    renderSideChat();
    act(() => openSideChat(SESSION_ID));

    await act(() => askSideChat(SESSION_ID, "Anything?"));

    expect(within(aside()).getByRole("alert").textContent).toBe(
      "No answer yet. Send a message in the main chat first, then ask again.",
    );
  });

  it("labels tool use while the answer is pending", async () => {
    let finish: () => void = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "assistant",
              message: {
                content: [
                  { type: "tool_use", name: "Read", input: { file_path: "/repo/src/config.ts" } },
                ],
              },
            })}\n`,
          ),
        );
        finish = () => controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream, { status: 200 })),
    );
    renderSideChat();
    act(() => openSideChat(SESSION_ID));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = askSideChat(SESSION_ID, "Where is config?");
    });

    await screen.findByText("Reading config.ts");
    await act(async () => {
      finish();
      await pending;
    });
  });

  it("branches an answer into a titled fork and navigates to it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ndjsonResponse([textDelta("An answer.")]))
      .mockResolvedValueOnce(
        ndjsonResponse([
          { type: "system", subtype: "init", session_id: "session-fork-200" },
          textDelta("Forked answer."),
          { type: "result", is_error: false, session_id: "session-fork-200" },
        ]),
      )
      .mockResolvedValueOnce(Response.json({ customTitle: "btw: Why?", title: "btw: Why?" }));
    vi.stubGlobal("fetch", fetchMock);
    renderSideChat();
    act(() => openSideChat(SESSION_ID));
    await act(() => askSideChat(SESSION_ID, "Why?"));

    fireEvent.click(screen.getByRole("button", { name: "Branch to new chat" }));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(
      fetchMock.mock.calls.slice(1).map(([url, init]) => [url, init.method, init.body]),
    ).toEqual([
      ["/api/chat", "POST", JSON.stringify({ sessionId: SESSION_ID, prompt: "Why?" })],
      ["/api/sessions/session-fork-200/title", "PUT", JSON.stringify({ title: "btw: Why?" })],
    ]);
    expect(navigate.mock.calls).toEqual([
      [{ to: "/session/$id", params: { id: "session-fork-200" } }],
    ]);
  });
});

describe("useSideChatShortcut", () => {
  it("toggles the side chat on the session page", () => {
    render(<ShortcutProbe available />);
    const event = pressToggle();
    expect([event.defaultPrevented, getSideChat(SESSION_ID).open]).toEqual([true, true]);
    pressToggle();
    expect(getSideChat(SESSION_ID).open).toBe(false);
  });

  it("declines the key when the session is not found", () => {
    render(<ShortcutProbe available={false} />);
    const event = pressToggle();
    expect([event.defaultPrevented, getSideChat(SESSION_ID).open]).toEqual([false, false]);
  });
});

describe("handleBtwPrompt", () => {
  it("passes ordinary prompts through", () => {
    const toast = vi.fn();
    expect(
      handleBtwPrompt("fix the build", { sessionId: SESSION_ID, messageCount: 3, toast }),
    ).toBe(false);
    expect([getSideChat(SESSION_ID).open, toast.mock.calls]).toEqual([false, []]);
  });

  it("opens the side chat for a bare /btw", () => {
    const toast = vi.fn();
    expect(handleBtwPrompt("/btw", { sessionId: SESSION_ID, messageCount: 3, toast })).toBe(true);
    expect([getSideChat(SESSION_ID), toast.mock.calls]).toEqual([{ open: true, entries: [] }, []]);
  });

  it("opens the side chat and asks the question", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjsonResponse([textDelta("Yes.")])),
    );
    handleBtwPrompt("/btw is it cached?", {
      sessionId: SESSION_ID,
      messageCount: 3,
      toast: vi.fn(),
    });
    await waitFor(() => expect(getSideChat(SESSION_ID).entries[0]?.status).toBe("done"));
    expect(
      getSideChat(SESSION_ID).entries.map(({ question, answer }) => ({ question, answer })),
    ).toEqual([{ question: "is it cached?", answer: "Yes." }]);
    expect(getSideChat(SESSION_ID).open).toBe(true);
  });

  it("refuses before the session's first message", () => {
    const toast = vi.fn();
    expect(handleBtwPrompt("/btw hi", { sessionId: SESSION_ID, messageCount: 0, toast })).toBe(
      true,
    );
    expect([getSideChat(SESSION_ID).open, toast.mock.calls]).toEqual([
      false,
      [
        [
          {
            kind: "error",
            message:
              "Side chat is available once this session starts. Send your first message to start it.",
          },
        ],
      ],
    ]);
  });
});
