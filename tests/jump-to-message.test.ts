// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { jumpToMessage } from "../src/lib/jump-to-message";

function addMessageAnchor(index: number): {
  element: HTMLDivElement;
  scrollIntoView: ReturnType<typeof vi.fn>;
} {
  const element = document.createElement("div");
  const scrollIntoView = vi.fn();
  element.id = `msg-${index}`;
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

  it("scrolls to the exact anchor and removes its highlight after two seconds", () => {
    const { element, scrollIntoView } = addMessageAnchor(100);

    expect(jumpToMessage(100)).toBe(true);
    expect(scrollIntoView.mock.calls).toStrictEqual([[{ block: "center", behavior: "smooth" }]]);
    expect(element.className).toBe("message-highlight");

    vi.advanceTimersByTime(1_999);
    expect(element.className).toBe("message-highlight");

    vi.advanceTimersByTime(1);
    expect(element.className).toBe("");
  });

  it("falls back to an anchor exactly 50 preceding indices away", () => {
    const { element, scrollIntoView } = addMessageAnchor(50);

    expect(jumpToMessage(100)).toBe(true);
    expect(scrollIntoView.mock.calls).toStrictEqual([[{ block: "center", behavior: "smooth" }]]);
    expect(element.className).toBe("message-highlight");
  });

  it("returns false when the nearest anchor is 51 preceding indices away", () => {
    const { element, scrollIntoView } = addMessageAnchor(49);

    expect(jumpToMessage(100)).toBe(false);
    expect(scrollIntoView.mock.calls).toStrictEqual([]);
    expect(element.className).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });
});
