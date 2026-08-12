// @vitest-environment jsdom

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { ChatInput } from "../src/components/chat-input";
import { useChatStream } from "../src/hooks/use-chat-stream";
import {
  getSessionPromptBehavior,
  routeSessionPrompt,
  useLiveHerdrPrompt,
} from "../src/components/session-page";

vi.mock("../src/components/session-chat", () => ({
  SessionChat: () => null,
}));

describe("session live input", () => {
  it("selects the live route only for a writable matching herdr pane", () => {
    const panes = [{ sessionId: "session-test-100" }];

    expect([
      getSessionPromptBehavior("session-test-100", true, { panes, writesEnabled: true }),
      getSessionPromptBehavior("session-test-100", true, { panes, writesEnabled: false }),
      getSessionPromptBehavior("session-test-200", false, { panes, writesEnabled: true }),
      getSessionPromptBehavior("session-test-200", true, { panes, writesEnabled: true }),
    ]).toStrictEqual([
      {
        disabled: false,
        deliveryHint: "- sends to live herdr session",
        usesHerdr: true,
      },
      {
        disabled: true,
        deliveryHint: "- live herdr input is disabled",
        usesHerdr: false,
      },
      { disabled: false, deliveryHint: undefined, usesHerdr: false },
      { disabled: true, deliveryHint: undefined, usesHerdr: false },
    ]);
  });

  it("keeps the no-pane fork call unchanged and bypasses it for live delivery", () => {
    const sendLivePrompt = vi.fn<(prompt: string) => Promise<void>>().mockResolvedValue();
    const sendForkedPrompt = vi
      .fn<(sessionId: string, prompt: string) => Promise<void>>()
      .mockResolvedValue();

    routeSessionPrompt(
      false,
      "session-test-100",
      "Continue Alice's test",
      sendLivePrompt,
      sendForkedPrompt,
    );
    routeSessionPrompt(
      true,
      "session-test-100",
      "Continue Bob's test",
      sendLivePrompt,
      sendForkedPrompt,
    );

    expect({
      liveCalls: sendLivePrompt.mock.calls,
      forkCalls: sendForkedPrompt.mock.calls,
    }).toStrictEqual({
      liveCalls: [["Continue Bob's test"]],
      forkCalls: [["session-test-100", "Continue Alice's test"]],
    });
  });

  it("shows the live delivery hint without changing ChatInput's send contract", () => {
    const onSend = vi.fn<(prompt: string) => void>();

    render(
      <ChatInput
        onSend={onSend}
        onCancel={() => {}}
        isStreaming={false}
        projectPath="/tmp/test/project"
        deliveryHint="- sends to live herdr session"
      />,
    );

    expect(screen.getByText("- sends to live herdr session").textContent).toBe(
      "- sends to live herdr session",
    );
    fireEvent.change(screen.getByPlaceholderText("Send a follow-up message..."), {
      target: { value: "Continue Alice's test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend.mock.calls).toStrictEqual([["Continue Alice's test"]]);
  });

  it("does not synchronously measure or resize the transcript textarea while typing", () => {
    render(<ChatInput onSend={() => {}} onCancel={() => {}} isStreaming={false} />);
    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(
      "Send a follow-up message...",
    );
    const readScrollHeight = vi.fn(() => 100);
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: readScrollHeight,
    });

    fireEvent.input(textarea, { target: { value: "Continue Alice's test" } });

    expect({
      height: textarea.style.height,
      scrollHeightReads: readScrollHeight.mock.calls,
      value: textarea.value,
    }).toStrictEqual({
      height: "",
      scrollHeightReads: [],
      value: "Continue Alice's test",
    });
  });

  it("reports an HTTP status instead of a JSON parser error for a malformed rejection", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Forbidden", {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.send("session-test-100", "Continue Alice's test");
    });

    expect({ calls: fetchMock.mock.calls, state: result.current.state }).toStrictEqual({
      calls: [
        [
          "/api/chat",
          {
            body: JSON.stringify({
              sessionId: "session-test-100",
              prompt: "Continue Alice's test",
            }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
            signal: expect.any(AbortSignal),
          },
        ],
      ],
      state: {
        error: "Request failed (403)",
        isComplete: true,
        isStreaming: false,
        sentPrompt: "Continue Alice's test",
        text: "",
      },
    });
    fetchMock.mockRestore();
  });

  it("keeps a sent prompt pending until transcript delivery", async () => {
    let finishPost: (() => void) | undefined;
    const postPrompt = vi.fn<(sessionId: string, prompt: string) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finishPost = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ recordCount }) => useLiveHerdrPrompt("session-test-100", recordCount, postPrompt),
      { initialProps: { recordCount: 100 } },
    );

    act(() => {
      void result.current.send("Continue Alice's test");
    });
    expect(result.current.state).toStrictEqual({
      error: "",
      isPending: true,
      prompt: "Continue Alice's test",
    });

    await act(async () => {
      if (!finishPost) throw new Error("Expected fabricated prompt request");
      finishPost();
    });
    expect(result.current.state).toStrictEqual({
      error: "",
      isPending: true,
      prompt: "Continue Alice's test",
    });

    rerender({ recordCount: 101 });
    await waitFor(() => {
      expect(result.current.state).toStrictEqual({ error: "", isPending: false, prompt: "" });
    });
  });

  it("reports a POST error and leaves the input out of pending state", async () => {
    const postPrompt = vi
      .fn<(sessionId: string, prompt: string) => Promise<void>>()
      .mockRejectedValue(new Error("Fabricated live prompt failure"));
    const { result } = renderHook(() => useLiveHerdrPrompt("session-test-100", 100, postPrompt));

    await act(async () => {
      await result.current.send("Continue Alice's test");
    });

    expect(result.current.state).toStrictEqual({
      error: "Fabricated live prompt failure",
      isPending: false,
      prompt: "Continue Alice's test",
    });
  });
});
