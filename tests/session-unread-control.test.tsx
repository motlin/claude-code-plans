// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { SessionRowStatusDot } from "../src/components/session-unread-control";
import type { SessionListItem } from "../src/lib/api/sessions";
import type { SessionBucket } from "../src/lib/session-state";
import {
  __unreadStoreTesting as __testing,
  syncUnseenFromSummaries,
} from "../src/lib/unread-store";

type PersistCall = { sessionId: string; action: "reviewed" | "unreviewed" };

function listItem(
  bucket: SessionBucket,
  overrides: Partial<SessionListItem> = {},
): SessionListItem {
  return {
    id: "session-test-100",
    title: "Fix the flaky test",
    mtime: "2026-09-28T10:00:00.000Z",
    created: "2026-09-28T09:00:00.000Z",
    project: "-projects-alpha",
    projectName: "alpha",
    messageCount: 4,
    archived: false,
    state: "idle",
    bucket,
    liveAgentCount: 0,
    unseen: false,
    blockedSince: null,
    ...overrides,
  };
}

function shownDot(container: HTMLElement): { toggle: string | null; kind: string } {
  return {
    toggle: screen.queryByRole("button")?.getAttribute("aria-label") ?? null,
    kind: container.querySelector("[data-kind]")?.getAttribute("data-kind") ?? "idle",
  };
}

describe("SessionRowStatusDot", () => {
  let calls: PersistCall[];

  beforeEach(() => {
    __testing.reset();
    calls = [];
    __testing.setPersist(async (sessionId, action) => {
      calls.push({ sessionId, action });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("toggles a finished row between the idle ring and the ready dot through the server flag", async () => {
    const { container } = render(<SessionRowStatusDot session={listItem("done")} />);
    const before = shownDot(container);

    fireEvent.click(screen.getByRole("button", { name: "Click to mark as unread" }));
    const afterMarkUnread = shownDot(container);
    fireEvent.click(screen.getByRole("button", { name: "Click to mark as read" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect({ before, afterMarkUnread, after: shownDot(container), calls }).toStrictEqual({
      before: { toggle: "Click to mark as unread", kind: "idle" },
      afterMarkUnread: { toggle: "Click to mark as read", kind: "ready" },
      after: { toggle: "Click to mark as unread", kind: "idle" },
      calls: [
        { sessionId: "session-test-100", action: "unreviewed" },
        { sessionId: "session-test-100", action: "reviewed" },
      ],
    });
  });

  it("shows the ready dot when the server summary reports the session unseen", () => {
    const { container } = render(<SessionRowStatusDot session={listItem("done")} />);

    act(() => syncUnseenFromSummaries([{ id: "session-test-100", unseen: true }]));

    expect(shownDot(container)).toStrictEqual({ toggle: "Click to mark as read", kind: "ready" });
  });

  it("keeps a review row the server did not flag unseen (an open PR) on the ready dot", () => {
    const { container } = render(<SessionRowStatusDot session={listItem("review")} />);

    expect(shownDot(container)).toStrictEqual({ toggle: "Click to mark as unread", kind: "ready" });
  });

  it.each([
    ["working", "running"],
    ["blocked", "awaiting"],
  ] as const)("offers no toggle on a %s row and persists nothing", (bucket, kind) => {
    const { container } = render(<SessionRowStatusDot session={listItem(bucket)} />);

    expect({ dot: shownDot(container), calls }).toStrictEqual({
      dot: { toggle: null, kind },
      calls: [],
    });
  });
});
