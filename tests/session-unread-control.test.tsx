// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { SessionUnreadControl } from "../src/components/session-unread-control";
import { clearAll } from "../src/lib/unread-store";
import { installLocalStorage } from "./fake-storage";

describe("SessionUnreadControl", () => {
  beforeEach(() => {
    installLocalStorage();
    clearAll();
  });

  it("toggles an idle session between seen and needs review", () => {
    render(<SessionUnreadControl sessionId="session-test-100" state="idle" />);

    expect(screen.getByRole("button", { name: "Mark unseen" }).textContent).toBe("●");
    fireEvent.click(screen.getByRole("button", { name: "Mark unseen" }));
    expect({
      label: screen.getByText("needs review").textContent,
      control: screen.getByRole("button", { name: "Mark seen" }).textContent,
    }).toStrictEqual({ label: "needs review", control: "○" });
  });

  it.each(["working", "waiting"] as const)(
    "raises unseen work without offering a manual control for %s rows",
    async (state) => {
      render(<SessionUnreadControl sessionId={`session-test-${state}`} state={state} />);

      await waitFor(() =>
        expect(localStorage.getItem("ccp-unseen-work")).toBe(
          JSON.stringify({ [`session-test-${state}`]: true }),
        ),
      );
      expect(screen.queryByRole("button")).toBe(null);
    },
  );
});
