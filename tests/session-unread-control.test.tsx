// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { SessionUnreadControl } from "../src/components/session-unread-control";
import {
  __unreadStoreTesting as __testing,
  syncUnseenFromSummaries,
} from "../src/lib/unread-store";

type PersistCall = { sessionId: string; action: "reviewed" | "unreviewed" };

describe("SessionUnreadControl", () => {
  let calls: PersistCall[];

  beforeEach(() => {
    __testing.reset();
    calls = [];
    __testing.setPersist(async (sessionId, action) => {
      calls.push({ sessionId, action });
    });
  });

  it("toggles an idle session between seen and needs review through the server flag", async () => {
    render(<SessionUnreadControl sessionId="session-test-100" state="idle" />);

    expect(screen.getByRole("button", { name: "Mark unseen" }).textContent).toBe("●");
    fireEvent.click(screen.getByRole("button", { name: "Mark unseen" }));
    const afterMarkUnseen = {
      label: screen.getByText("needs review").textContent,
      control: screen.getByRole("button", { name: "Mark seen" }).textContent,
    };
    fireEvent.click(screen.getByRole("button", { name: "Mark seen" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect({
      afterMarkUnseen,
      control: screen.getByRole("button", { name: "Mark unseen" }).textContent,
      calls,
    }).toStrictEqual({
      afterMarkUnseen: { label: "needs review", control: "○" },
      control: "●",
      calls: [
        { sessionId: "session-test-100", action: "unreviewed" },
        { sessionId: "session-test-100", action: "reviewed" },
      ],
    });
  });

  it("shows review when the server summary reports the session unseen", () => {
    render(<SessionUnreadControl sessionId="session-test-100" state="idle" />);

    act(() => syncUnseenFromSummaries([{ id: "session-test-100", unseen: true }]));

    expect(screen.getByText("needs review").textContent).toBe("needs review");
  });

  it.each(["working", "waiting"] as const)(
    "offers no manual control for %s rows and persists nothing",
    (state) => {
      render(<SessionUnreadControl sessionId={`session-test-${state}`} state={state} />);

      expect({ button: screen.queryByRole("button"), calls }).toStrictEqual({
        button: null,
        calls: [],
      });
    },
  );

  it("renders no status for an ended session", () => {
    const { container } = render(
      <SessionUnreadControl sessionId="session-test-ended" state="ended" />,
    );

    expect({
      childElementCount: container.childElementCount,
      textContent: container.textContent,
    }).toStrictEqual({
      childElementCount: 0,
      textContent: "",
    });
  });
});
