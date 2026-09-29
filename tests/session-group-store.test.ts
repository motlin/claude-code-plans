// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  SESSION_GROUP_STORAGE_KEY,
  assign,
  createGroup,
  deleteGroup,
  listGroups,
  moveGroup,
  readSessionGroupState,
  renameGroup,
  setGroupAppearance,
  setGroupOrder,
  useSessionGroups,
} from "../src/lib/session-group-store";
import { installLocalStorage } from "./fake-storage";

function stored(): unknown {
  const raw = localStorage.getItem(SESSION_GROUP_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

const EMPTY = { groups: [], assignments: {}, order: {} };

describe("session group store", () => {
  let storage: ReturnType<typeof installLocalStorage>;
  let uuidCounter: number;

  beforeEach(() => {
    storage = installLocalStorage();
    uuidCounter = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      uuidCounter += 1;
      return `00000000-0000-4000-8000-00000000000${uuidCounter}` as const;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts empty when storage is absent", () => {
    expect({ state: readSessionGroupState(), groups: listGroups() }).toStrictEqual({
      state: EMPTY,
      groups: [],
    });
  });

  it("creates, renames and deletes groups", () => {
    const upstream = createGroup("  Upstream sync ");
    const gtd = createGroup("GTD");
    renameGroup(gtd.id, " Getting things done ");
    renameGroup(gtd.id, "   ");
    renameGroup("cg-missing", "Nope");
    const afterRename = stored();

    assign("session-alice", upstream.id);
    assign("session-bob", upstream.id, { before: null });
    assign("session-carol", gtd.id);
    const released = deleteGroup(upstream.id);
    const releasedMissing = deleteGroup("cg-missing");

    expect({
      upstream,
      gtd,
      afterRename,
      released,
      releasedMissing,
      final: readSessionGroupState(),
    }).toStrictEqual({
      upstream: { id: "cg-00000000-0000-4000-8000-000000000001", name: "Upstream sync" },
      gtd: { id: "cg-00000000-0000-4000-8000-000000000002", name: "GTD" },
      afterRename: {
        groups: [
          { id: "cg-00000000-0000-4000-8000-000000000001", name: "Upstream sync" },
          { id: "cg-00000000-0000-4000-8000-000000000002", name: "Getting things done" },
        ],
        assignments: {},
        order: {},
      },
      released: 2,
      releasedMissing: 0,
      final: {
        groups: [{ id: "cg-00000000-0000-4000-8000-000000000002", name: "Getting things done" }],
        assignments: { "session-carol": "cg-00000000-0000-4000-8000-000000000002" },
        order: {},
      },
    });
  });

  it("sets, merges and clears a group's icon and color, round-tripping through storage", () => {
    const a = createGroup("A");
    const b = createGroup("B");
    setGroupAppearance(a.id, { icon: "rocket", color: "blue" });
    const both = stored();
    setGroupAppearance(a.id, { color: "red" });
    const recolored = readSessionGroupState().groups[0];
    setGroupAppearance(a.id, { icon: null });
    const iconCleared = readSessionGroupState().groups[0];
    setGroupAppearance(a.id, { color: null });
    setGroupAppearance("cg-missing", { icon: "star" });
    setGroupAppearance(b.id, { icon: "star" });
    renameGroup(b.id, "Bee");

    expect({ both, recolored, iconCleared, final: readSessionGroupState() }).toStrictEqual({
      both: {
        groups: [
          { id: a.id, name: "A", icon: "rocket", color: "blue" },
          { id: b.id, name: "B" },
        ],
        assignments: {},
        order: {},
      },
      recolored: { id: a.id, name: "A", icon: "rocket", color: "red" },
      iconCleared: { id: a.id, name: "A", color: "red" },
      final: {
        groups: [
          { id: a.id, name: "A" },
          { id: b.id, name: "Bee", icon: "star" },
        ],
        assignments: {},
        order: {},
      },
    });
  });

  it("rejects a blank group name without touching storage", () => {
    expect({
      error: (() => {
        try {
          createGroup("   ");
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      })(),
      stored: stored(),
    }).toStrictEqual({ error: "Group name must not be blank", stored: null });
  });

  it("assign moves a session between groups and unassigns with null", () => {
    const a = createGroup("A");
    const b = createGroup("B");
    assign("session-alice", a.id, { before: null });
    assign("session-bob", a.id, { before: null });
    const inA = readSessionGroupState();

    assign("session-alice", b.id);
    const movedToB = readSessionGroupState();

    assign("session-bob", null);
    assign("session-carol", "cg-missing");

    expect({ inA, movedToB, final: readSessionGroupState() }).toStrictEqual({
      inA: {
        groups: [a, b],
        assignments: { "session-alice": a.id, "session-bob": a.id },
        order: { [a.id]: ["session-alice", "session-bob"] },
      },
      movedToB: {
        groups: [a, b],
        assignments: { "session-alice": b.id, "session-bob": a.id },
        order: { [a.id]: ["session-bob"] },
      },
      final: {
        groups: [a, b],
        assignments: { "session-alice": b.id },
        order: {},
      },
    });
  });

  it("inserts before another session in the group order, or at the end", () => {
    const a = createGroup("A");
    assign("session-alice", a.id, { before: null });
    assign("session-bob", a.id, { before: null });
    assign("session-carol", a.id, { before: "session-alice" });
    const beforeAlice = readSessionGroupState().order[a.id];
    assign("session-bob", a.id, { before: "session-carol" });
    const bobFirst = readSessionGroupState().order[a.id];
    assign("session-dave", a.id, { before: "session-unordered" });

    expect({ beforeAlice, bobFirst, final: readSessionGroupState() }).toStrictEqual({
      beforeAlice: ["session-carol", "session-alice", "session-bob"],
      bobFirst: ["session-bob", "session-carol", "session-alice"],
      final: {
        groups: [a],
        assignments: {
          "session-alice": a.id,
          "session-bob": a.id,
          "session-carol": a.id,
          "session-dave": a.id,
        },
        order: { [a.id]: ["session-bob", "session-carol", "session-alice", "session-dave"] },
      },
    });
  });

  it("replaces a group's manual order, ignoring unknown groups", () => {
    const a = createGroup("A");
    assign("session-alice", a.id, { before: null });
    setGroupOrder(a.id, ["session-bob", "session-alice"]);
    const replaced = readSessionGroupState().order;
    setGroupOrder("cg-missing", ["session-carol"]);
    setGroupOrder(a.id, []);

    expect({ replaced, final: readSessionGroupState() }).toStrictEqual({
      replaced: { [a.id]: ["session-bob", "session-alice"] },
      final: { groups: [a], assignments: { "session-alice": a.id }, order: {} },
    });
  });

  it("moves a group to a clamped index", () => {
    const a = createGroup("A");
    const b = createGroup("B");
    const c = createGroup("C");
    moveGroup(c.id, 0);
    const cFirst = listGroups().map((group) => group.name);
    moveGroup(c.id, 99);
    const cLast = listGroups().map((group) => group.name);
    moveGroup(a.id, -5);
    moveGroup("cg-missing", 0);

    expect({ cFirst, cLast, final: listGroups() }).toStrictEqual({
      cFirst: ["C", "A", "B"],
      cLast: ["A", "B", "C"],
      final: [a, b, c],
    });
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["the wrong shape", JSON.stringify({ groups: {}, assignments: {}, order: {} })],
    ["unknown keys", JSON.stringify({ ...EMPTY, extra: true })],
    [
      "unknown group keys",
      JSON.stringify({
        groups: [{ id: "cg-1", name: "A", icon: "x" }],
        assignments: {},
        order: {},
      }),
    ],
    [
      "an unknown group color",
      JSON.stringify({
        groups: [{ id: "cg-1", name: "A", color: "chartreuse" }],
        assignments: {},
        order: {},
      }),
    ],
    [
      "an assignment to a missing group",
      JSON.stringify({ groups: [], assignments: { "session-alice": "cg-1" }, order: {} }),
    ],
    [
      "an order list for a missing group",
      JSON.stringify({ groups: [], assignments: {}, order: { "cg-1": ["session-alice"] } }),
    ],
    [
      "duplicate group ids",
      JSON.stringify({
        groups: [
          { id: "cg-1", name: "A" },
          { id: "cg-1", name: "B" },
        ],
        assignments: {},
        order: {},
      }),
    ],
  ])("falls back to empty on %s", (_label, raw) => {
    localStorage.setItem(SESSION_GROUP_STORAGE_KEY, raw);

    expect(readSessionGroupState()).toStrictEqual(EMPTY);
  });

  it("falls back to empty and keeps working when storage throws", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => createGroup("A")).not.toThrow();
    expect(readSessionGroupState()).toStrictEqual(EMPTY);
  });

  it("updates every hook instance, including from another tab's storage event", () => {
    const first = renderHook(() => useSessionGroups());
    const second = renderHook(() => useSessionGroups());

    let group = { id: "", name: "" };
    act(() => {
      group = createGroup("A");
      assign("session-alice", group.id);
    });
    const afterLocal = {
      first: first.result.current.groups,
      second: second.result.current.groupOf("session-alice"),
    };

    const otherTab = JSON.stringify({
      groups: [{ id: "cg-other", name: "Other" }],
      assignments: { "session-bob": "cg-other" },
      order: { "cg-other": ["session-bob"] },
    });
    act(() => {
      localStorage.setItem(SESSION_GROUP_STORAGE_KEY, otherTab);
      window.dispatchEvent(
        new StorageEvent("storage", { key: SESSION_GROUP_STORAGE_KEY, newValue: otherTab }),
      );
    });

    expect({
      afterLocal,
      afterStorageEvent: {
        groups: second.result.current.groups,
        assignments: second.result.current.assignments,
        order: second.result.current.order,
        alice: second.result.current.groupOf("session-alice"),
        bob: second.result.current.groupOf("session-bob"),
      },
    }).toStrictEqual({
      afterLocal: { first: [group], second: group.id },
      afterStorageEvent: {
        groups: [{ id: "cg-other", name: "Other" }],
        assignments: { "session-bob": "cg-other" },
        order: { "cg-other": ["session-bob"] },
        alice: null,
        bob: "cg-other",
      },
    });
  });
});
