import { describe, expect, it } from "vite-plus/test";

import { DEFAULTS, type Settings } from "../src/components/settings-provider";
import { notificationCopy, shouldNotify } from "../src/lib/attention";

const enabled: Settings = { ...DEFAULTS, notifyCompletions: true, notifyPermissionRequests: true };
const disabled: Settings = {
  ...DEFAULTS,
  notifyCompletions: false,
  notifyPermissionRequests: false,
};

describe("shouldNotify", () => {
  it("notifies for the viewed session when its tab is hidden", () => {
    expect(
      shouldNotify(
        enabled,
        "waiting",
        true,
        "granted",
        "session-test-100",
        "session-test-100",
        false,
      ),
    ).toBe(true);
  });

  it("does not notify when the setting is off", () => {
    expect(
      shouldNotify(disabled, "waiting", true, "granted", "session-test-100", null, false),
    ).toBe(false);
  });

  it("suppresses the visible session currently on screen", () => {
    expect(
      shouldNotify(
        enabled,
        "waiting",
        false,
        "granted",
        "session-test-100",
        "session-test-100",
        false,
      ),
    ).toBe(false);
  });

  it("notifies for a different session while the tab is visible", () => {
    expect(
      shouldNotify(
        enabled,
        "waiting",
        false,
        "granted",
        "session-test-100",
        "session-test-200",
        false,
      ),
    ).toBe(true);
  });

  it("does not notify when permission is not granted", () => {
    expect(shouldNotify(enabled, "waiting", true, "default", "session-test-100", null, false)).toBe(
      false,
    );
    expect(shouldNotify(enabled, "waiting", true, "denied", "session-test-100", null, false)).toBe(
      false,
    );
  });
});

describe("shouldNotify per notification kind", () => {
  const onlyCompletions: Settings = {
    ...DEFAULTS,
    notifyCompletions: true,
    notifyPermissionRequests: false,
  };
  const onlyPermissionRequests: Settings = {
    ...DEFAULTS,
    notifyCompletions: false,
    notifyPermissionRequests: true,
  };
  const notifies = (settings: Settings) => ({
    waiting: shouldNotify(settings, "waiting", true, "granted", "session-test-100", null, false),
    review: shouldNotify(settings, "review", true, "granted", "session-test-100", null, false),
    working: shouldNotify(settings, "working", true, "granted", "session-test-100", null, false),
  });

  it("fires the waiting transition only with notifyPermissionRequests", () => {
    expect(notifies(onlyPermissionRequests)).toStrictEqual({
      waiting: true,
      review: false,
      working: false,
    });
  });

  it("fires the review transition only with notifyCompletions", () => {
    expect(notifies(onlyCompletions)).toStrictEqual({
      waiting: false,
      review: true,
      working: false,
    });
  });

  it("defaults to completions on and permission requests off, like upstream", () => {
    expect(notifies(DEFAULTS)).toStrictEqual({ waiting: false, review: true, working: false });
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
