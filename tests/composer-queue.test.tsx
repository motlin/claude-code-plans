// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Composer, type ComposerQueueView } from "../src/components/composer";
import { useLiveHerdrPrompt } from "../src/components/session-page";
import { type DeliveryResult, useComposerQueue } from "../src/hooks/use-composer-queue";
import { useStopResponse } from "../src/hooks/use-stop-response";
import { HerdrRequestError, isAgentNotReady, sendHerdrPrompt } from "../src/lib/api/herdr";
import {
  clearComposerQueues,
  composerQueueReducer,
  nextQueuedPrompt,
  type QueuedPrompt,
  queuedStatusText,
} from "../src/lib/composer-queue";
import type { SlashCommand } from "../src/lib/slash-commands";

vi.mock("../src/components/session-chat", () => ({
  SessionChat: () => null,
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  clearComposerQueues();
  vi.useRealTimers();
});

const ALICE: QueuedPrompt = { id: "q1", text: "Alice's first follow-up" };
const BOB: QueuedPrompt = { id: "q2", text: "Bob's second follow-up" };
const CAROL: QueuedPrompt = { id: "q3", text: "Carol's third follow-up" };

describe("composerQueueReducer", () => {
  it("enqueues at the back by default and at the front on request", () => {
    const back = composerQueueReducer([ALICE], { type: "enqueue", item: BOB });
    const front = composerQueueReducer(back, { type: "enqueue", item: CAROL, position: "front" });
    expect({ back, front }).toStrictEqual({
      back: [ALICE, BOB],
      front: [CAROL, ALICE, BOB],
    });
  });

  it("edits a queued prompt's text in place", () => {
    expect(
      composerQueueReducer([ALICE, BOB], { type: "edit", id: "q2", text: "Bob, edited" }),
    ).toStrictEqual([ALICE, { id: "q2", text: "Bob, edited" }]);
  });

  it("removes a queued prompt", () => {
    expect(composerQueueReducer([ALICE, BOB, CAROL], { type: "remove", id: "q2" })).toStrictEqual([
      ALICE,
      CAROL,
    ]);
  });

  it("reorders a queued prompt to a clamped index", () => {
    const queue = [ALICE, BOB, CAROL];
    expect({
      toFront: composerQueueReducer(queue, { type: "reorder", id: "q3", toIndex: 0 }),
      toBack: composerQueueReducer(queue, { type: "reorder", id: "q1", toIndex: 99 }),
      missing: composerQueueReducer(queue, { type: "reorder", id: "nope", toIndex: 0 }),
    }).toStrictEqual({
      toFront: [CAROL, ALICE, BOB],
      toBack: [BOB, CAROL, ALICE],
      missing: [ALICE, BOB, CAROL],
    });
  });

  it("offers the head for flushing only once the session is idle", () => {
    expect({
      busy: nextQueuedPrompt([ALICE, BOB], true),
      idle: nextQueuedPrompt([ALICE, BOB], false),
      empty: nextQueuedPrompt([], false),
    }).toStrictEqual({ busy: null, idle: ALICE, empty: null });
  });

  it("words the sr-only status with the upstream plural", () => {
    expect([queuedStatusText(1), queuedStatusText(3)]).toStrictEqual([
      "1 message queued. Will send after the current response.",
      "3 messages queued. Will send after the current response.",
    ]);
  });
});

describe("409 agent_not_ready → queued", () => {
  function fetcherReturning(status: number, body: unknown): typeof fetch {
    return async () => Response.json(body, { status });
  }

  it("throws a HerdrRequestError carrying the status and herdr code", async () => {
    const error: unknown = await sendHerdrPrompt(
      "session-alice",
      "Alice's prompt",
      fetcherReturning(409, { error: "agent is working", code: "agent_not_ready" }),
    ).catch((caught: unknown) => caught);

    expect({
      isRequestError: error instanceof HerdrRequestError,
      status: error instanceof HerdrRequestError ? error.status : null,
      code: error instanceof HerdrRequestError ? error.code : null,
      message: error instanceof Error ? error.message : null,
      notReady: isAgentNotReady(error),
    }).toStrictEqual({
      isRequestError: true,
      status: 409,
      code: "agent_not_ready",
      message: "agent is working",
      notReady: true,
    });
  });

  it("does not treat a stalled prompt or other errors as not-ready", async () => {
    const stalled: unknown = await sendHerdrPrompt(
      "session-alice",
      "Alice's prompt",
      fetcherReturning(409, { error: "stalled", code: "agent_prompt_stalled" }),
    ).catch((caught: unknown) => caught);
    expect([
      isAgentNotReady(stalled),
      isAgentNotReady(new Error("agent_not_ready")),
      isAgentNotReady(null),
    ]).toStrictEqual([false, false, false]);
  });

  it("useLiveHerdrPrompt reports not-ready without surfacing an error", async () => {
    const postPrompt = vi
      .fn<(sessionId: string, prompt: string) => Promise<void>>()
      .mockRejectedValue(new HerdrRequestError("agent is working", 409, "agent_not_ready"));
    const { result } = renderHook(() => useLiveHerdrPrompt("session-alice", 100, postPrompt));

    let delivery: DeliveryResult | undefined;
    await act(async () => {
      delivery = await result.current.send("Alice's prompt");
    });

    expect({ delivery, state: result.current.state }).toStrictEqual({
      delivery: "not-ready",
      state: { error: "", isPending: false, prompt: "" },
    });
  });

  it("useLiveHerdrPrompt reports sent and failed deliveries", async () => {
    const postPrompt = vi
      .fn<(sessionId: string, prompt: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Fabricated failure"));
    const { result } = renderHook(() => useLiveHerdrPrompt("session-alice", 100, postPrompt));

    const deliveries: DeliveryResult[] = [];
    await act(async () => {
      deliveries.push(await result.current.send("Alice's prompt"));
    });
    await act(async () => {
      deliveries.push(await result.current.send("Bob's prompt"));
    });

    expect(deliveries).toStrictEqual(["sent", "failed"]);
  });
});

type Deliver = (text: string) => Promise<DeliveryResult>;

/** The session turns busy as soon as a prompt is delivered, like the live pane's pending send. */
function renderQueue({
  busy,
  deliver,
  interrupt = vi.fn<() => void>(),
  sessionId = "session-alice",
}: {
  busy: boolean;
  deliver: Deliver;
  interrupt?: () => void;
  sessionId?: string;
}) {
  const hook = renderHook(() => {
    const [isBusy, setBusy] = useState(busy);
    const queue = useComposerQueue({
      sessionId,
      busy: isBusy,
      deliver: async (text) => {
        const result = await deliver(text);
        if (result === "sent") setBusy(true);
        return result;
      },
      interrupt,
      retryMs: 20,
    });
    return { queue, setBusy };
  });
  return {
    result: {
      get current() {
        return hook.result.current.queue;
      },
    },
    setBusy: (next: boolean) => act(() => hook.result.current.setBusy(next)),
  };
}

describe("useComposerQueue", () => {
  it("holds prompts while busy and flushes one at a time on each idle", async () => {
    const deliver = vi.fn<Deliver>(async () => "sent");
    const { result, setBusy } = renderQueue({ busy: true, deliver });

    act(() => {
      result.current.enqueue("Alice's first follow-up");
      result.current.enqueue("Bob's second follow-up");
    });
    expect({
      texts: result.current.items.map((item) => item.text),
      delivered: deliver.mock.calls,
    }).toStrictEqual({
      texts: ["Alice's first follow-up", "Bob's second follow-up"],
      delivered: [],
    });

    setBusy(false);
    await waitFor(() => expect(deliver.mock.calls.length).toBe(1));
    expect({
      texts: result.current.items.map((item) => item.text),
      delivered: deliver.mock.calls,
    }).toStrictEqual({
      texts: ["Bob's second follow-up"],
      delivered: [["Alice's first follow-up"]],
    });

    setBusy(false);
    await waitFor(() => expect(deliver.mock.calls.length).toBe(2));
    expect({
      texts: result.current.items.map((item) => item.text),
      delivered: deliver.mock.calls,
    }).toStrictEqual({
      texts: [],
      delivered: [["Alice's first follow-up"], ["Bob's second follow-up"]],
    });
  });

  it("puts a not-ready prompt back at the head and retries", async () => {
    const deliver = vi
      .fn<Deliver>()
      .mockResolvedValueOnce("not-ready")
      .mockResolvedValueOnce("sent");
    const { result, setBusy } = renderQueue({ busy: true, deliver });
    act(() => {
      result.current.enqueue("Alice's first follow-up");
      result.current.enqueue("Bob's second follow-up");
    });

    setBusy(false);
    await waitFor(() => expect(deliver.mock.calls.length).toBe(2));

    expect({
      delivered: deliver.mock.calls,
      texts: result.current.items.map((item) => item.text),
    }).toStrictEqual({
      delivered: [["Alice's first follow-up"], ["Alice's first follow-up"]],
      texts: ["Bob's second follow-up"],
    });
  });

  it("Send now moves a queued prompt to the head and interrupts a busy session", () => {
    const deliver = vi.fn<Deliver>(async () => "sent");
    const interrupt = vi.fn<() => void>();
    const { result } = renderQueue({ busy: true, deliver, interrupt });
    act(() => {
      result.current.enqueue("Alice's first follow-up");
      result.current.enqueue("Bob's second follow-up");
    });
    const bob = result.current.items[1];
    if (bob === undefined) throw new Error("Expected Bob's queued prompt");

    act(() => result.current.sendNow(bob.id));
    act(() => result.current.sendNowText("Carol's urgent prompt"));

    expect({
      texts: result.current.items.map((item) => item.text),
      interrupts: interrupt.mock.calls.length,
      delivered: deliver.mock.calls,
    }).toStrictEqual({
      texts: ["Carol's urgent prompt", "Bob's second follow-up", "Alice's first follow-up"],
      interrupts: 2,
      delivered: [],
    });
  });

  it("keeps queues per session", () => {
    const deliver = vi.fn<Deliver>(async () => "sent");
    const alice = renderQueue({ busy: true, deliver, sessionId: "session-alice" });
    const bob = renderQueue({ busy: true, deliver, sessionId: "session-bob" });
    act(() => alice.result.current.enqueue("Alice's follow-up"));

    expect({
      alice: alice.result.current.items.map((item) => item.text),
      bob: bob.result.current.items.map((item) => item.text),
    }).toStrictEqual({ alice: ["Alice's follow-up"], bob: [] });
  });
});

function renderComposer({
  queue,
  onSend = vi.fn(),
  onSendNow,
  onStop,
  slashCommands,
}: {
  queue?: ComposerQueueView;
  onSend?: (prompt: string) => void;
  onSendNow?: (prompt: string) => void;
  onStop?: () => void;
  slashCommands?: readonly SlashCommand[];
}) {
  render(
    <Composer
      variant="session"
      draftKey="session-alice"
      onSend={(prompt) => onSend(prompt)}
      onStop={onStop}
      queue={queue}
      onSendNow={onSendNow}
      slashCommands={slashCommands}
    />,
  );
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Prompt" });
}

function queueView(items: readonly QueuedPrompt[]) {
  return {
    items,
    sendNow: vi.fn<(id: string) => void>(),
    remove: vi.fn<(id: string) => void>(),
  };
}

async function openChipMenu(index: number) {
  const triggers = screen.getAllByRole("button", { name: "Queued message actions" });
  const trigger = triggers[index];
  if (trigger === undefined) throw new Error(`Expected chip ${index}`);
  fireEvent.click(trigger);
  return await screen.findByRole("menu");
}

describe("Composer queued chips", () => {
  it("lists queued prompts above the composer with an sr-only status", () => {
    renderComposer({ queue: queueView([ALICE, BOB]) });

    const list = screen.getByRole("list", { name: "Queued messages" });
    expect({
      chips: within(list)
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("data-queued-text")),
      status: screen.getByRole("status").textContent,
    }).toStrictEqual({
      chips: ["Alice's first follow-up", "Bob's second follow-up"],
      status: "2 messages queued. Will send after the current response.",
    });
  });

  it("renders nothing without queued prompts", () => {
    renderComposer({ queue: queueView([]) });
    expect(screen.queryByRole("list", { name: "Queued messages" })).toBeNull();
  });

  it("offers Edit in composer / Send now / Remove from queue", async () => {
    renderComposer({ queue: queueView([ALICE]) });
    const menu = await openChipMenu(0);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toStrictEqual(["Edit in composer", "Send now", "Remove from queue"]);
  });

  it("Edit in composer moves the prompt back into the editor", async () => {
    const queue = queueView([ALICE, BOB]);
    const textarea = renderComposer({ queue });
    const menu = await openChipMenu(1);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Edit in composer" }));

    expect({ value: textarea.value, removed: queue.remove.mock.calls }).toStrictEqual({
      value: "Bob's second follow-up",
      removed: [["q2"]],
    });
  });

  it("Send now forwards the chip id", async () => {
    const queue = queueView([ALICE, BOB]);
    renderComposer({ queue });
    const menu = await openChipMenu(1);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Send now" }));
    expect(queue.sendNow.mock.calls).toStrictEqual([["q2"]]);
  });

  it("Remove from queue asks to discard first", async () => {
    const queue = queueView([ALICE]);
    renderComposer({ queue });
    const menu = await openChipMenu(0);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Remove from queue" }));
    const dialog = await screen.findByRole("alertdialog");
    const beforeConfirm = queue.remove.mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));

    expect({
      title: within(dialog).getByRole("heading").textContent,
      beforeConfirm,
      removed: queue.remove.mock.calls,
    }).toStrictEqual({
      title: "Discard queued message?",
      beforeConfirm: 0,
      removed: [["q1"]],
    });
  });
});

describe("Composer while working", () => {
  it("keeps the editor enabled and sends on Enter while the slot is Stop response", () => {
    const onSend = vi.fn<(prompt: string) => void>();
    const textarea = renderComposer({ onSend, onStop: () => {} });
    fireEvent.change(textarea, { target: { value: "Alice's follow-up" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect({
      disabled: textarea.disabled,
      sent: onSend.mock.calls,
      cleared: textarea.value,
    }).toStrictEqual({ disabled: false, sent: [["Alice's follow-up"]], cleared: "" });
  });

  it("sends now on ⌘⏎ and Ctrl+⏎", () => {
    const onSend = vi.fn<(prompt: string) => void>();
    const onSendNow = vi.fn<(prompt: string) => void>();
    const textarea = renderComposer({ onSend, onSendNow, onStop: () => {} });
    fireEvent.change(textarea, { target: { value: "Alice's urgent prompt" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    fireEvent.change(textarea, { target: { value: "Bob's urgent prompt" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect({ sent: onSend.mock.calls, now: onSendNow.mock.calls }).toStrictEqual({
      sent: [],
      now: [["Alice's urgent prompt"], ["Bob's urgent prompt"]],
    });
  });
});

describe("Esc modal guard", () => {
  function Stopper({
    onInterrupt,
    queue,
    slashCommands,
  }: {
    onInterrupt: () => void;
    queue?: ComposerQueueView;
    slashCommands?: readonly SlashCommand[];
  }) {
    const stop = useStopResponse({
      sessionId: "session-alice",
      enabled: true,
      interrupt: async () => {},
      onInterrupt,
      onError: () => {},
    });
    return (
      <Composer
        variant="session"
        draftKey="session-alice"
        onSend={() => {}}
        onStop={stop}
        queue={queue}
        slashCommands={slashCommands}
      />
    );
  }

  it("stops on Esc from the editor when nothing is open", () => {
    const onInterrupt = vi.fn<() => void>();
    render(<Stopper onInterrupt={onInterrupt} />);
    const textarea = screen.getByRole("textbox", { name: "Prompt" });
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "Escape", code: "Escape" });
    expect(onInterrupt.mock.calls.length).toBe(1);
  });

  it("closes the slash popup instead of stopping", () => {
    const onInterrupt = vi.fn<() => void>();
    render(
      <Stopper
        onInterrupt={onInterrupt}
        slashCommands={[{ name: "review", description: "Review code", source: "builtin" }]}
      />,
    );
    const textarea = screen.getByRole("textbox", { name: "Prompt" });
    textarea.focus();
    fireEvent.change(textarea, { target: { value: "/rev" } });
    const openBefore = screen.queryByRole("menu") !== null;
    fireEvent.keyDown(textarea, { key: "Escape", code: "Escape" });

    expect({ openBefore, interrupts: onInterrupt.mock.calls.length }).toStrictEqual({
      openBefore: true,
      interrupts: 0,
    });
  });

  it("does not stop while the discard dialog is open", async () => {
    const onInterrupt = vi.fn<() => void>();
    render(<Stopper onInterrupt={onInterrupt} queue={queueView([ALICE])} />);
    const menu = await openChipMenu(0);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Remove from queue" }));
    const dialog = await screen.findByRole("alertdialog");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Escape", code: "Escape" });

    expect(onInterrupt.mock.calls.length).toBe(0);
  });
});
