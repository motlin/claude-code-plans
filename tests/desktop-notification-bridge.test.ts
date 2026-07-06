import { describe, expect, it } from "vite-plus/test";

import { shouldNotify } from "../src/components/desktop-notification-bridge";
import { DEFAULTS, type Settings } from "../src/components/settings-provider";

const enabled: Settings = { ...DEFAULTS, desktopNotifications: true };
const disabled: Settings = { ...DEFAULTS, desktopNotifications: false };

describe("shouldNotify", () => {
  it("notifies when opted in, tab backgrounded, and permission granted", () => {
    expect(shouldNotify(enabled, true, "granted", "agent_needs_input")).toBe(true);
  });

  it("does not notify when the setting is off", () => {
    expect(shouldNotify(disabled, true, "granted", "agent_needs_input")).toBe(false);
  });

  it("does not notify when the tab is visible", () => {
    expect(shouldNotify(enabled, false, "granted", "agent_completed")).toBe(false);
  });

  it("does not notify when permission is not granted", () => {
    expect(shouldNotify(enabled, true, "default", "agent_completed")).toBe(false);
    expect(shouldNotify(enabled, true, "denied", "agent_completed")).toBe(false);
  });

  it("still notifies for an unknown notification type (graceful degradation)", () => {
    expect(shouldNotify(enabled, true, "granted", "something_new")).toBe(true);
    expect(shouldNotify(enabled, true, "granted", "")).toBe(true);
  });
});
