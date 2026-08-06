// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { JumpChips } from "../src/components/jump-chips";
import { jumpToMessage } from "../src/lib/jump-to-message";
import type { ResourceOccurrence } from "../src/lib/session-resources";

const displaySettings = vi.hoisted(() => ({ showThinking: true, showTools: true }));

vi.mock("../src/components/settings-provider", () => ({
  useSettings: () => ({ settings: displaySettings }),
}));

vi.mock("../src/lib/jump-to-message", () => ({
  jumpToMessage: vi.fn(),
}));

const OCCURRENCES: ResourceOccurrence[] = [
  { source: "visible", lineArrayIndex: 30, role: "user" },
  { source: "tool", lineArrayIndex: 10, role: "assistant", tool: "Read" },
  { source: "thinking", lineArrayIndex: 20, role: "assistant" },
];

describe("JumpChips", () => {
  beforeEach(() => {
    displaySettings.showThinking = true;
    displaySettings.showTools = true;
    vi.mocked(jumpToMessage).mockReset();
  });

  it("numbers mentions in transcript order and dispatches their array indices", () => {
    render(<JumpChips occurrences={OCCURRENCES} />);

    for (const mentionNumber of [1, 2, 3]) {
      fireEvent.click(
        screen.getByRole("button", { name: `Jump to file mention ${mentionNumber}` }),
      );
    }

    expect({
      chipLabels: screen.getAllByRole("button").map((button) => button.textContent),
      jumpCalls: vi.mocked(jumpToMessage).mock.calls,
    }).toStrictEqual({ chipLabels: ["1", "2", "3"], jumpCalls: [[10], [20], [30]] });
  });

  it("disables tool and thinking mentions with settings explanations", () => {
    displaySettings.showThinking = false;
    displaySettings.showTools = false;
    render(<JumpChips occurrences={OCCURRENCES} />);

    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);
    fireEvent.click(buttons[2]!);

    expect({
      disabled: buttons.map((button) => (button as HTMLButtonElement).disabled),
      titles: buttons.map((button) => button.getAttribute("title")),
      jumpCalls: vi.mocked(jumpToMessage).mock.calls,
    }).toStrictEqual({
      disabled: [true, true, false],
      titles: [
        "This mention is hidden because tool calls are disabled in display settings.",
        "This mention is hidden because thinking is disabled in display settings.",
        "Jump to mention 3",
      ],
      jumpCalls: [[30]],
    });
  });
});
