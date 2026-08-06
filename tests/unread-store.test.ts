import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  __testing,
  clearAll,
  hasUnseenWork,
  markSeen,
  markUnseen,
  observeSessionState,
} from "../src/lib/unread-store";
import { installLocalStorage } from "./fake-storage";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

function restoreWindow(): void {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
}

describe("unread-store", () => {
  beforeEach(() => {
    __testing.resetPreviousDisplayStates();
    const localStorage = installLocalStorage();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage },
    });
  });

  afterEach(() => {
    restoreWindow();
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("persists exact unseen records and removes the key after the last session is seen", () => {
    markUnseen("session-test-100");
    markUnseen("session-test-200");

    expect({
      first: hasUnseenWork("session-test-100"),
      second: hasUnseenWork("session-test-200"),
      unrelated: hasUnseenWork("session-test-300"),
      stored: window.localStorage.getItem("ccp-unseen-work"),
    }).toStrictEqual({
      first: true,
      second: true,
      unrelated: false,
      stored: JSON.stringify({ "session-test-100": true, "session-test-200": true }),
    });

    markSeen("session-test-100");
    expect(window.localStorage.getItem("ccp-unseen-work")).toBe(
      JSON.stringify({ "session-test-200": true }),
    );
    markSeen("session-test-200");
    expect(window.localStorage.getItem("ccp-unseen-work")).toBe(null);
  });

  it("raises only for observed working and waiting activity", () => {
    observeSessionState("session-test-idle", "idle");
    observeSessionState("session-test-unknown", "unknown");
    observeSessionState("session-test-working", "working");
    observeSessionState("session-test-waiting", "waiting");

    expect({
      idle: hasUnseenWork("session-test-idle"),
      unknown: hasUnseenWork("session-test-unknown"),
      working: hasUnseenWork("session-test-working"),
      waiting: hasUnseenWork("session-test-waiting"),
    }).toStrictEqual({ idle: false, unknown: false, working: true, waiting: true });
  });

  it("seeds review before a manual mark-unseen action", () => {
    markUnseen("session-test-100");

    expect(__testing.previousDisplayState("session-test-100")).toBe("review");
  });

  it.each([
    ["malformed JSON", "{not-json"],
    ["an array", JSON.stringify(["session-test-100"])],
    ["a non-true record value", JSON.stringify({ "session-test-100": false })],
  ])("treats %s as an empty store", (_description, stored) => {
    window.localStorage.setItem("ccp-unseen-work", stored);

    expect(hasUnseenWork("session-test-100")).toBe(false);
  });

  it("never throws when localStorage is unavailable", () => {
    Reflect.deleteProperty(globalThis, "window");

    expect(() => {
      markUnseen("session-test-100");
      markSeen("session-test-100");
      clearAll();
    }).not.toThrow();
    expect(hasUnseenWork("session-test-100")).toBe(false);
  });

  it("never throws when the browser denies localStorage access", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: Object.defineProperty({}, "localStorage", {
        get() {
          throw new DOMException("Storage denied", "SecurityError");
        },
      }),
    });

    expect(() => {
      markUnseen("session-test-100");
      markSeen("session-test-100");
      clearAll();
    }).not.toThrow();
    expect(hasUnseenWork("session-test-100")).toBe(false);
  });
});
