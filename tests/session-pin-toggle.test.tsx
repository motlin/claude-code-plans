// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { SessionPinToggle } from "../src/components/session-pin-toggle";
import { PIN_STORAGE_KEY, readPinState } from "../src/lib/pin-store";
import { installLocalStorage } from "./fake-storage";

const SESSION_ID = "session-alice-100";

describe("SessionPinToggle", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  afterEach(() => {
    cleanup();
  });

  it("pins and unpins the session in this browser", () => {
    render(<SessionPinToggle sessionId={SESSION_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Star session" }));
    const afterPin = readPinState();
    fireEvent.click(screen.getByRole("button", { name: "Unstar session" }));

    expect({ afterPin, afterUnpin: readPinState() }).toStrictEqual({
      afterPin: { pinnedIds: [SESSION_ID], pinnedOrder: [] },
      afterUnpin: { pinnedIds: [], pinnedOrder: [] },
    });
  });

  it("follows a pin made in another tab", () => {
    render(<SessionPinToggle sessionId={SESSION_ID} />);
    const otherTab = JSON.stringify({ pinnedIds: [SESSION_ID], pinnedOrder: [] });

    act(() => {
      localStorage.setItem(PIN_STORAGE_KEY, otherTab);
      window.dispatchEvent(
        new StorageEvent("storage", { key: PIN_STORAGE_KEY, newValue: otherTab }),
      );
    });

    expect(
      screen.getByRole("button", { name: "Unstar session" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
