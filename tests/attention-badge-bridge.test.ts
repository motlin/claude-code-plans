import { describe, expect, it } from "vite-plus/test";

import { countSessionsNeedingAttention } from "../src/components/attention-badge-bridge";
import { DEFAULTS, type Settings } from "../src/components/settings-provider";

const enabled: Settings = { ...DEFAULTS, desktopNotifications: true };
const disabled: Settings = { ...DEFAULTS, desktopNotifications: false };

const sessions = [
  { sessionId: "session-test-waiting", displayState: "waiting" },
  { sessionId: "session-test-review", displayState: "review" },
  { sessionId: "session-test-working", displayState: "working" },
  { sessionId: "session-test-idle", displayState: "idle" },
  { sessionId: "session-test-unknown", displayState: "unknown" },
] as const;

describe("countSessionsNeedingAttention", () => {
  it("counts waiting and review sessions", () => {
    expect(countSessionsNeedingAttention([...sessions], enabled, true, null)).toBe(2);
  });

  it("applies the global alert opt-out", () => {
    expect(countSessionsNeedingAttention([...sessions], disabled, true, null)).toBe(0);
  });

  it("applies the visible session alert gate", () => {
    expect(
      countSessionsNeedingAttention([...sessions], enabled, false, "session-test-waiting"),
    ).toBe(1);
  });
});
