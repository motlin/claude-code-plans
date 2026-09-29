import { describe, expect, it } from "vite-plus/test";
import { parseSettingsHash, settingsHash } from "../src/lib/settings-hash";

describe("parseSettingsHash", () => {
  const cases: ReadonlyArray<readonly [string, ReturnType<typeof parseSettingsHash>]> = [
    ["#settings/general", { tab: "general", row: null }],
    ["settings/general", { tab: "general", row: null }],
    ["#settings/usage", { tab: "usage", row: null }],
    ["#settings/claude-code/code-font", { tab: "claude-code", row: "code-font" }],
    ["#settings/ai-features", { tab: "ai-features", row: null }],
    ["#settings/claude-config", { tab: "claude-config", row: null }],
    ["#settings/setup", { tab: "setup", row: null }],
    ["#settings/transcript/", { tab: "transcript", row: null }],
    ["", null],
    ["#", null],
    ["#settings", null],
    ["#settings/", null],
    ["#settings/account", null],
    ["#settings/General", null],
    ["#settings/general/Code Font", null],
    ["#settings/general/code-font/extra", null],
    ["#other/general", null],
    ["#message-42", null],
  ];

  it.each(cases)("parses %j", (hash, expected) => {
    expect(parseSettingsHash(hash)).toEqual(expected);
  });
});

describe("settingsHash", () => {
  it("builds the hash for a tab", () => {
    expect(settingsHash("sessions")).toBe("settings/sessions");
  });

  it("builds the hash for a tab row", () => {
    expect(settingsHash("claude-code", "code-font")).toBe("settings/claude-code/code-font");
  });
});
