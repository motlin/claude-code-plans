// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  PIN_STORAGE_KEY,
  isPinned,
  movePin,
  orderedPins,
  pin,
  readPinState,
  unpin,
  usePins,
} from "../src/lib/pin-store";
import { installLocalStorage } from "./fake-storage";

interface Row {
  id: string;
  mtime: number;
}

const byMtimeDesc = (a: Row, b: Row): number => b.mtime - a.mtime;

function stored(): unknown {
  const raw = localStorage.getItem(PIN_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe("pin store", () => {
  let storage: ReturnType<typeof installLocalStorage>;

  beforeEach(() => {
    storage = installLocalStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts empty when storage is absent", () => {
    expect({ state: readPinState(), pinned: isPinned("session-alice") }).toStrictEqual({
      state: { pinnedIds: [], pinnedOrder: [] },
      pinned: false,
    });
  });

  it("pins without ordering and unpins from both lists", () => {
    pin("session-alice");
    pin("session-bob");
    pin("session-alice");
    const afterPin = { stored: stored(), alice: isPinned("session-alice") };

    movePin("session-bob", null);
    unpin("session-bob");

    expect({
      afterPin,
      afterUnpin: stored(),
      bob: isPinned("session-bob"),
    }).toStrictEqual({
      afterPin: {
        stored: { pinnedIds: ["session-alice", "session-bob"], pinnedOrder: [] },
        alice: true,
      },
      afterUnpin: { pinnedIds: ["session-alice"], pinnedOrder: [] },
      bob: false,
    });
  });

  it("inserts a pin at a position in the order", () => {
    pin("session-alice", 0);
    pin("session-bob", 0);
    pin("session-carol", 1);
    pin("session-dave", 99);

    expect(readPinState()).toStrictEqual({
      pinnedIds: ["session-alice", "session-bob", "session-carol", "session-dave"],
      pinnedOrder: ["session-bob", "session-carol", "session-alice", "session-dave"],
    });
  });

  it("re-pinning an ordered pin at a new position moves it", () => {
    pin("session-alice", 0);
    pin("session-bob", 1);
    pin("session-alice", 1);

    expect(readPinState()).toStrictEqual({
      pinnedIds: ["session-alice", "session-bob"],
      pinnedOrder: ["session-bob", "session-alice"],
    });
  });

  it("reorders pins before another pin or to the end", () => {
    pin("session-alice", 0);
    pin("session-bob", 1);
    pin("session-carol", 2);
    movePin("session-carol", "session-alice");
    const beforeAlice = readPinState().pinnedOrder;
    movePin("session-carol", null);
    const atEnd = readPinState().pinnedOrder;
    pin("session-dave");
    movePin("session-dave", "session-bob");
    const unorderedMoved = readPinState().pinnedOrder;
    movePin("session-erin", null);

    expect({ beforeAlice, atEnd, unorderedMoved, final: readPinState() }).toStrictEqual({
      beforeAlice: ["session-carol", "session-alice", "session-bob"],
      atEnd: ["session-alice", "session-bob", "session-carol"],
      unorderedMoved: ["session-alice", "session-dave", "session-bob", "session-carol"],
      final: {
        pinnedIds: ["session-alice", "session-bob", "session-carol", "session-dave"],
        pinnedOrder: ["session-alice", "session-dave", "session-bob", "session-carol"],
      },
    });
  });

  it("orders explicitly ordered pins first, then unordered pins by the comparator", () => {
    pin("session-alice");
    pin("session-bob", 0);
    pin("session-carol");
    pin("session-dave", 0);
    const sessions: Row[] = [
      { id: "session-alice", mtime: 1 },
      { id: "session-bob", mtime: 2 },
      { id: "session-carol", mtime: 3 },
      { id: "session-dave", mtime: 4 },
      { id: "session-erin", mtime: 5 },
    ];

    expect(orderedPins(sessions, byMtimeDesc).map((row) => row.id)).toStrictEqual([
      "session-dave",
      "session-bob",
      "session-carol",
      "session-alice",
    ]);
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["the wrong shape", JSON.stringify({ pinnedIds: "session-alice", pinnedOrder: [] })],
    ["unknown keys", JSON.stringify({ pinnedIds: [], pinnedOrder: [], extra: true })],
  ])("falls back to empty on %s", (_label, raw) => {
    localStorage.setItem(PIN_STORAGE_KEY, raw);

    expect(readPinState()).toStrictEqual({ pinnedIds: [], pinnedOrder: [] });
  });

  it("falls back to empty and keeps working when storage throws", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => pin("session-alice")).not.toThrow();
    expect(readPinState()).toStrictEqual({ pinnedIds: [], pinnedOrder: [] });
  });

  it("updates every hook instance, including from another tab's storage event", () => {
    const first = renderHook(() => usePins());
    const second = renderHook(() => usePins());

    act(() => pin("session-alice"));
    const afterLocal = {
      first: first.result.current.pinnedIds,
      second: second.result.current.isPinned("session-alice"),
    };

    const otherTab = JSON.stringify({ pinnedIds: ["session-bob"], pinnedOrder: ["session-bob"] });
    act(() => {
      localStorage.setItem(PIN_STORAGE_KEY, otherTab);
      window.dispatchEvent(
        new StorageEvent("storage", { key: PIN_STORAGE_KEY, newValue: otherTab }),
      );
    });

    expect({
      afterLocal,
      afterStorageEvent: {
        pinnedIds: second.result.current.pinnedIds,
        pinnedOrder: second.result.current.pinnedOrder,
        alice: second.result.current.isPinned("session-alice"),
        bob: second.result.current.isPinned("session-bob"),
      },
    }).toStrictEqual({
      afterLocal: { first: ["session-alice"], second: true },
      afterStorageEvent: {
        pinnedIds: ["session-bob"],
        pinnedOrder: ["session-bob"],
        alice: false,
        bob: true,
      },
    });
  });
});
