import { describe, expect, it } from "vite-plus/test";

import {
  getSessionMenuItems,
  SessionMenuItemIdSchema,
  type SessionMenuCapability,
  type SessionMenuSession,
} from "../src/lib/session-menu-items";

const ALL: ReadonlySet<SessionMenuCapability> = new Set<SessionMenuCapability>([
  "openLiveTerminal",
  "openPr",
  "pin",
  "readState",
  "ackAwaiting",
  "rename",
  "copyLink",
  "fork",
  "archive",
]);

const LOCAL: ReadonlySet<SessionMenuCapability> = new Set<SessionMenuCapability>([
  "openLiveTerminal",
  "pin",
  "readState",
  "copyLink",
]);

function session(overrides: Partial<SessionMenuSession> = {}): SessionMenuSession {
  return {
    title: "Fix the flaky test",
    pinned: false,
    readState: "read",
    archived: false,
    prUrl: null,
    hasLivePane: false,
    forkDisabledReason: null,
    ...overrides,
  };
}

const SEPARATOR = { kind: "separator" } as const;

describe("getSessionMenuItems", () => {
  it("lists a read row in upstream order", () => {
    expect(getSessionMenuItems(session(), ALL, { surface: "row" })).toEqual([
      { kind: "item", id: "pin", label: "Pin", accelerator: "p" },
      { kind: "item", id: "mark-unread", label: "Mark as unread", accelerator: "u" },
      { kind: "item", id: "rename", label: "Rename", accelerator: "r" },
      { kind: "item", id: "copy-link", label: "Copy link", accelerator: "c" },
      { kind: "item", id: "fork", label: "Fork", accelerator: "f" },
      SEPARATOR,
      { kind: "item", id: "archive", label: "Archive", accelerator: "a" },
    ]);
  });

  it("offers Mark as read and Unpin for an unread pinned row", () => {
    expect(
      getSessionMenuItems(session({ readState: "unread", pinned: true }), LOCAL, {
        surface: "row",
      }),
    ).toEqual([
      { kind: "item", id: "unpin", label: "Unpin", accelerator: "p" },
      { kind: "item", id: "mark-read", label: "Mark as read", accelerator: "u" },
      { kind: "item", id: "copy-link", label: "Copy link", accelerator: "c" },
    ]);
  });

  it("offers Mark as completed on a waiting row", () => {
    expect(
      getSessionMenuItems(session({ readState: "awaiting" }), ALL, { surface: "row" }).slice(0, 2),
    ).toEqual([
      { kind: "item", id: "pin", label: "Pin", accelerator: "p" },
      { kind: "item", id: "mark-completed", label: "Mark as completed", accelerator: "u" },
    ]);
  });

  it("drops the waiting acknowledgement when it is not wired", () => {
    expect(
      getSessionMenuItems(session({ readState: "awaiting" }), LOCAL, { surface: "row" }),
    ).toEqual([
      { kind: "item", id: "pin", label: "Pin", accelerator: "p" },
      { kind: "item", id: "copy-link", label: "Copy link", accelerator: "c" },
    ]);
  });

  it("has no read-state item on a working row", () => {
    expect(
      getSessionMenuItems(session({ readState: "working" }), LOCAL, { surface: "row" }),
    ).toEqual([
      { kind: "item", id: "pin", label: "Pin", accelerator: "p" },
      { kind: "item", id: "copy-link", label: "Copy link", accelerator: "c" },
    ]);
  });

  it("shows Open PR when the session has a PR and no Open in submenu", () => {
    expect(
      getSessionMenuItems(session({ prUrl: "https://github.com/o/r/pull/7" }), ALL, {
        surface: "row",
      }).slice(0, 3),
    ).toEqual([
      { kind: "item", id: "open-pr", label: "Open PR", accelerator: "g" },
      SEPARATOR,
      { kind: "item", id: "pin", label: "Pin", accelerator: "p" },
    ]);
  });

  it("omits Open PR without a PR", () => {
    const ids = getSessionMenuItems(session(), ALL, { surface: "row" }).map((item) =>
      item.kind === "item" ? item.id : "|",
    );
    expect(ids).toEqual(["pin", "mark-unread", "rename", "copy-link", "fork", "|", "archive"]);
  });

  it("puts the live terminal in Open in when a herdr pane is live", () => {
    expect(
      getSessionMenuItems(
        session({ hasLivePane: true, prUrl: "https://github.com/o/r/pull/7" }),
        LOCAL,
        { surface: "row" },
      ),
    ).toEqual([
      {
        kind: "item",
        id: "open-in",
        label: "Open in",
        submenu: [
          { kind: "item", id: "open-live-terminal", label: "Live terminal", accelerator: "1" },
        ],
      },
      SEPARATOR,
      { kind: "item", id: "pin", label: "Pin", accelerator: "p" },
      { kind: "item", id: "mark-unread", label: "Mark as unread", accelerator: "u" },
      { kind: "item", id: "copy-link", label: "Copy link", accelerator: "c" },
    ]);
  });

  it("offers Unarchive for an archived session", () => {
    expect(
      getSessionMenuItems(session({ archived: true }), ALL, { surface: "row" }).at(-1),
    ).toEqual({ kind: "item", id: "unarchive", label: "Unarchive", accelerator: "a" });
  });

  it("disables Fork with its reason", () => {
    expect(
      getSessionMenuItems(
        session({ forkDisabledReason: "Session file is still being written" }),
        ALL,
        { surface: "row" },
      ).find((item) => item.kind === "item" && item.id === "fork"),
    ).toEqual({
      kind: "item",
      id: "fork",
      label: "Fork",
      accelerator: "f",
      disabled: true,
      disabledReason: "Session file is still being written",
    });
  });

  it("never offers Share or Delete", () => {
    const cloudOrDestructive: readonly string[] = ["share", "delete"];
    expect(SessionMenuItemIdSchema.options.filter((id) => cloudOrDestructive.includes(id))).toEqual(
      [],
    );
  });

  it("drops Pin and read state from the header menu", () => {
    expect(
      getSessionMenuItems(session({ hasLivePane: true, readState: "unread" }), ALL, {
        surface: "header",
      }),
    ).toEqual([
      {
        kind: "item",
        id: "open-in",
        label: "Open in",
        submenu: [
          { kind: "item", id: "open-live-terminal", label: "Live terminal", accelerator: "1" },
        ],
      },
      SEPARATOR,
      { kind: "item", id: "rename", label: "Rename", accelerator: "r" },
      { kind: "item", id: "copy-link", label: "Copy link", accelerator: "c" },
      { kind: "item", id: "fork", label: "Fork", accelerator: "f" },
      SEPARATOR,
      { kind: "item", id: "archive", label: "Archive", accelerator: "a" },
    ]);
  });

  it("lists the palette row-actions card items unnumbered in upstream card order", () => {
    expect(
      getSessionMenuItems(session({ hasLivePane: true }), ALL, { surface: "palette-card" }),
    ).toEqual([
      { kind: "item", id: "copy-link", label: "Copy link" },
      { kind: "item", id: "pin", label: "Pin" },
      { kind: "item", id: "rename", label: "Rename" },
      { kind: "item", id: "archive", label: "Archive" },
      { kind: "item", id: "mark-unread", label: "Mark as unread" },
    ]);
  });

  it("offers local palette card items for a pinned unread session", () => {
    expect(
      getSessionMenuItems(session({ pinned: true, readState: "unread" }), LOCAL, {
        surface: "palette-card",
      }),
    ).toEqual([
      { kind: "item", id: "copy-link", label: "Copy link" },
      { kind: "item", id: "unpin", label: "Unpin" },
      { kind: "item", id: "mark-read", label: "Mark as read" },
    ]);
  });

  it("names the session in flat palette commands, truncated to 39 characters", () => {
    const title = "A very long session title that keeps going on";
    expect(
      getSessionMenuItems(session({ title, hasLivePane: true, pinned: true }), ALL, {
        surface: "palette",
      }),
    ).toEqual([
      { kind: "item", id: "unpin", label: "Unpin “A very long session title that keeps go…”" },
      { kind: "item", id: "rename", label: "Rename “A very long session title that keeps go…”" },
      {
        kind: "item",
        id: "copy-link",
        label: "Copy link to “A very long session title that keeps go…”",
      },
      { kind: "item", id: "fork", label: "Fork “A very long session title that keeps go…”" },
      { kind: "item", id: "archive", label: "Archive “A very long session title that keeps go…”" },
    ]);
  });
});
