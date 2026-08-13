// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { jumpToMessage } from "../src/lib/jump-to-message";

interface Anchor {
  element: HTMLDivElement;
  scrollIntoView: ReturnType<typeof vi.fn>;
}

/** A rendered turn: addressed by its uuid, carrying its record index for the walk. */
function addMessageAnchor(uuid: string | undefined, recordIndex: number): Anchor {
  const element = document.createElement("div");
  const scrollIntoView = vi.fn();
  if (uuid !== undefined) element.id = `msg-${uuid}`;
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

  it("scrolls to the turn carrying the anchored uuid and removes its highlight after two seconds", () => {
    const { element, scrollIntoView } = addMessageAnchor("u-100", 100);

    expect(jumpToMessage({ uuid: "u-100", recordIndex: 100 })).toBe(true);
    expect(scrollIntoView.mock.calls).toStrictEqual([[{ block: "center", behavior: "smooth" }]]);
    expect(element.className).toBe("message-highlight");

    vi.advanceTimersByTime(1_999);
    expect(element.className).toBe("message-highlight");

    vi.advanceTimersByTime(1);
    expect(element.className).toBe("");
  });

  it("walks back to the row that swallowed the record when its uuid renders no row of its own", () => {
    const { element, scrollIntoView } = addMessageAnchor("u-50", 50);

    expect(jumpToMessage({ uuid: "u-100", recordIndex: 100 })).toBe(true);
    expect(scrollIntoView.mock.calls).toStrictEqual([[{ block: "center", behavior: "smooth" }]]);
    expect(element.className).toBe("message-highlight");
  });

  it("resolves a legacy record-index anchor with no uuid at all", () => {
    const { element } = addMessageAnchor("u-100", 100);

    expect(jumpToMessage({ recordIndex: 100 })).toBe(true);
    expect(element.className).toBe("message-highlight");
  });

  it("returns false when the nearest row is 51 preceding indices away", () => {
    const { element, scrollIntoView } = addMessageAnchor("u-49", 49);

    expect(jumpToMessage({ uuid: "u-100", recordIndex: 100 })).toBe(false);
    expect(scrollIntoView.mock.calls).toStrictEqual([]);
    expect(element.className).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns false for a uuid with no record index to walk back from", () => {
    addMessageAnchor("u-100", 100);

    expect(jumpToMessage({ uuid: "u-99" })).toBe(false);
  });
});
