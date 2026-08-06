import { describe, expect, it } from "vite-plus/test";

import { notificationCopy, shouldNotify } from "../src/components/desktop-notification-bridge";
import { DEFAULTS, type Settings } from "../src/components/settings-provider";

const enabled: Settings = { ...DEFAULTS, desktopNotifications: true };
const disabled: Settings = { ...DEFAULTS, desktopNotifications: false };

describe("shouldNotify", () => {
  it("notifies for the viewed session when its tab is hidden", () => {
    expect(shouldNotify(enabled, true, "granted", "session-test-100", "session-test-100")).toBe(
      true,
    );
  });

  it("does not notify when the setting is off", () => {
    expect(shouldNotify(disabled, true, "granted", "session-test-100", null)).toBe(false);
  });

  it("suppresses the visible session currently on screen", () => {
    expect(shouldNotify(enabled, false, "granted", "session-test-100", "session-test-100")).toBe(
      false,
    );
  });

  it("notifies for a different session while the tab is visible", () => {
    expect(shouldNotify(enabled, false, "granted", "session-test-100", "session-test-200")).toBe(
      true,
    );
  });

  it("does not notify when permission is not granted", () => {
    expect(shouldNotify(enabled, true, "default", "session-test-100", null)).toBe(false);
    expect(shouldNotify(enabled, true, "denied", "session-test-100", null)).toBe(false);
  });
});

describe("notificationCopy", () => {
  it("returns copy only for transitions into attention states", () => {
    expect([
      notificationCopy("working", "waiting", "Alice session"),
      notificationCopy("working", "review", "Bob session"),
      notificationCopy("waiting", "waiting", "Alice session"),
      notificationCopy("waiting", "working", "Alice session"),
    ]).toStrictEqual([
      "Alice session is waiting on you",
      "Bob session finished — needs review",
      null,
      null,
    ]);
  });
});
