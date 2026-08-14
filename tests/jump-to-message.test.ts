// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { jumpToMessage } from "../src/lib/jump-to-message";

interface Row {
  element: HTMLDivElement;
  scrollIntoView: ReturnType<typeof vi.fn>;
}

/** A rendered turn, carrying the session-absolute record index it starts at. */
function addTurnRow(recordIndex: number): Row {
  const element = document.createElement("div");
  const scrollIntoView = vi.fn();
  element.dataset["recordIndex"] = String(recordIndex);
  element.scrollIntoView = scrollIntoView;
  document.body.appendChild(element);
  return { element, scrollIntoView };
}

describe("jumpToMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("scrolls to the turn carrying the record index and removes its highlight after two seconds", () => {
    const { element, scrollIntoView } = addTurnRow(100);

    expect(jumpToMessage(100)).toBe(true);
    expect(scrollIntoView.mock.calls).toStrictEqual([[{ block: "center", behavior: "smooth" }]]);
    expect(element.className).toBe("message-highlight");

    vi.advanceTimersByTime(1_999);
    expect(element.className).toBe("message-highlight");

    vi.advanceTimersByTime(1);
    expect(element.className).toBe("");
  });

  it("walks back to the row that swallowed the record when it renders no row of its own", () => {
    const { element, scrollIntoView } = addTurnRow(50);

    expect(jumpToMessage(100)).toBe(true);
    expect(scrollIntoView.mock.calls).toStrictEqual([[{ block: "center", behavior: "smooth" }]]);
    expect(element.className).toBe("message-highlight");
  });

  it("returns false when the nearest row is 51 preceding indices away", () => {
    const { element, scrollIntoView } = addTurnRow(49);

    expect(jumpToMessage(100)).toBe(false);
    expect(scrollIntoView.mock.calls).toStrictEqual([]);
    expect(element.className).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns false when the transcript holds no rows at all", () => {
    expect(jumpToMessage(0)).toBe(false);
  });
});
