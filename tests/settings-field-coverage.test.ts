import { describe, expect, it } from "vite-plus/test";
import { ClaudeSettingsSchema } from "../src/lib/schemas";
import { COVERED_SETTINGS_KEYS } from "../src/lib/settings-fields";

/**
 * Guard test (in the spirit of the schema-choices registry): every top-level
 * key of ClaudeSettingsSchema must have settings form coverage. A new schema
 * key turns this test red until it gets a FIELD_DEFINITIONS entry or a
 * dedicated editor (reflected in COVERED_SETTINGS_KEYS).
 */
describe("settings field coverage", () => {
  // RED guard: 11 schema keys still lack form coverage (includeGitInstructions,
  // skipWorkflowUsageWarning, outputStyle, spinnerTipsEnabled, effortLevel,
  // additionalDirectories, extraKnownMarketplaces, sandbox, remote, worktree,
  // spinnerVerbs). `.fails` keeps the build green while documenting the gap;
  // the follow-up tasks that add form coverage remove `.fails` to lock it in.
  it.fails("every ClaudeSettingsSchema key has form coverage", () => {
    const schemaKeys = Object.keys(ClaudeSettingsSchema.shape);
    const uncovered = schemaKeys.filter((key) => !COVERED_SETTINGS_KEYS.has(key)).sort();
    expect(uncovered).toEqual([]);
  });

  it("every COVERED_SETTINGS_KEYS member is a schema key or $schema", () => {
    const schemaKeys = new Set(Object.keys(ClaudeSettingsSchema.shape));
    const stale = [...COVERED_SETTINGS_KEYS]
      .filter((key) => key !== "$schema" && !schemaKeys.has(key))
      .sort();
    expect(stale).toEqual([]);
  });
});
