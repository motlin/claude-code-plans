// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Composer } from "../src/components/composer";
import type { QueuedPrompt } from "../src/lib/composer-queue";
import type { SlashCommand } from "../src/lib/slash-commands";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const HISTORY = ["water the basil", "plant tomatoes"];

function renderComposer(
  props: {
    queueItems?: readonly QueuedPrompt[];
    onEditRemove?: (id: string) => void;
    slashCommands?: readonly SlashCommand[];
  } = {},
) {
  render(
    <Composer
      variant="session"
      draftKey="session-alice"
      onSend={() => {}}
      promptHistory={HISTORY}
      slashCommands={props.slashCommands}
      queue={
        props.queueItems === undefined
          ? undefined
          : {
              items: props.queueItems,
              sendNow: () => {},
              remove: props.onEditRemove ?? (() => {}),
            }
      }
    />,
  );
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Prompt" });
}

function type(textarea: HTMLTextAreaElement, value: string, caret = value.length) {
  fireEvent.change(textarea, { target: { value } });
  textarea.setSelectionRange(caret, caret);
}

describe("Composer prompt history", () => {
  it("walks prior prompts with ↑ and back to the draft with ↓", () => {
    const textarea = renderComposer();
    type(textarea, "draft");
    const seen: string[] = [];
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    seen.push(textarea.value);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    seen.push(textarea.value);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    seen.push(textarea.value);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    seen.push(textarea.value);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    seen.push(textarea.value);
    expect(seen).toStrictEqual([
      "water the basil",
      "plant tomatoes",
      "plant tomatoes",
      "water the basil",
      "draft",
    ]);
  });

  it("restores the draft on Escape", () => {
    const textarea = renderComposer();
    type(textarea, "my draft");
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    const walked = textarea.value;
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect({ walked, restored: textarea.value }).toStrictEqual({
      walked: "plant tomatoes",
      restored: "my draft",
    });
  });

  it("leaves ↑ alone when the caret is below the first line", () => {
    const textarea = renderComposer();
    type(textarea, "first\nsecond");
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("first\nsecond");
  });

  it("lets the slash popup keep ↑/↓ while it is open", () => {
    const textarea = renderComposer({
      slashCommands: [{ name: "model", description: "Switch model", source: "builtin" }],
    });
    type(textarea, "/mo");
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("/mo");
  });

  it("recalls the last queued prompt for editing with ↑ in an empty editor", () => {
    const remove = vi.fn<(id: string) => void>();
    const textarea = renderComposer({
      queueItems: [
        { id: "q1", text: "Alice's queued follow-up" },
        { id: "q2", text: "Bob's queued follow-up" },
      ],
      onEditRemove: remove,
    });
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect({ value: textarea.value, removed: remove.mock.calls }).toStrictEqual({
      value: "Bob's queued follow-up",
      removed: [["q2"]],
    });
  });
});
