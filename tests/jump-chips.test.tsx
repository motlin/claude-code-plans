// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { JumpChips } from "../src/components/jump-chips";
import { JumpTargetProvider } from "../src/components/jump-target-context";
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
  { source: "visible", anchorIndex: 30, anchorUuid: "u-30", role: "user" },
  { source: "tool", anchorIndex: 10, anchorUuid: "u-10", role: "assistant", tool: "Read" },
  { source: "thinking", anchorIndex: 20, role: "assistant" },
];

describe("JumpChips", () => {
  beforeEach(() => {
    displaySettings.showThinking = true;
    displaySettings.showTools = true;
    vi.mocked(jumpToMessage).mockReset();
  });

  it("numbers mentions in transcript order and jumps to each mention's own message", () => {
    render(<JumpChips occurrences={OCCURRENCES} />);

    for (const mentionNumber of [1, 2, 3]) {
      fireEvent.click(
        screen.getByRole("button", { name: `Jump to file mention ${mentionNumber}` }),
      );
    }

    expect({
      chipLabels: screen.getAllByRole("button").map((button) => button.textContent),
      jumpCalls: vi.mocked(jumpToMessage).mock.calls,
    }).toStrictEqual({
      chipLabels: ["1", "2", "3"],
      jumpCalls: [
        [{ uuid: "u-10", recordIndex: 10 }],
        [{ recordIndex: 20 }],
        [{ uuid: "u-30", recordIndex: 30 }],
      ],
    });
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
      jumpCalls: [[{ uuid: "u-30", recordIndex: 30 }]],
    });
  });

  it("routes a mention outside the loaded window through its message anchor", () => {
    const openMessageAnchor = vi.fn();
    render(
      <JumpTargetProvider value={{ windowStartIndex: 25, openMessageAnchor }}>
        <JumpChips occurrences={OCCURRENCES} />
      </JumpTargetProvider>,
    );

    const buttons = screen.getAllByRole("button");
    for (const button of buttons) fireEvent.click(button);

    expect({
      disabled: buttons.map((button) => (button as HTMLButtonElement).disabled),
      titles: buttons.map((button) => button.getAttribute("title")),
      anchorCalls: openMessageAnchor.mock.calls,
      jumpCalls: vi.mocked(jumpToMessage).mock.calls,
    }).toStrictEqual({
      disabled: [false, true, false],
      titles: [
        "Jump to mention 1",
        "This mention is in an earlier part of the session that cannot be linked to.",
        "Jump to mention 3",
      ],
      // The uuid-less record at 20 has no anchor to link to, so its chip is
      // disabled rather than scrolling to whatever sits at index 20 today.
      anchorCalls: [["u-10"]],
      jumpCalls: [[{ uuid: "u-30", recordIndex: 30 }]],
    });
  });

  it("keeps jumping straight at the DOM once the window holds the mention", () => {
    const openMessageAnchor = vi.fn();
    render(
      <JumpTargetProvider value={{ windowStartIndex: 10, openMessageAnchor }}>
        <JumpChips occurrences={OCCURRENCES} />
      </JumpTargetProvider>,
    );

    for (const button of screen.getAllByRole("button")) fireEvent.click(button);

    expect({
      anchorCalls: openMessageAnchor.mock.calls,
      jumpCalls: vi.mocked(jumpToMessage).mock.calls,
    }).toStrictEqual({
      anchorCalls: [],
      jumpCalls: [
        [{ uuid: "u-10", recordIndex: 10 }],
        [{ recordIndex: 20 }],
        [{ uuid: "u-30", recordIndex: 30 }],
      ],
    });
  });
});
