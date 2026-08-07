import { describe, expect, it } from "vite-plus/test";
import { ClaudeSettingsSchema } from "../src/lib/schemas";
import { COVERED_SETTINGS_KEYS } from "../src/lib/settings-fields";
import {
  CAPABILITY_IDS,
  DEFAULT_CAPABILITIES,
  PersistedCapabilitiesSchema,
} from "../src/lib/capabilities";

/**
 * Guard test (in the spirit of the schema-choices registry): every top-level
 * key of ClaudeSettingsSchema must have settings form coverage. A new schema
 * key turns this test red until it gets an editable field, dedicated editor,
 * or read-only summary (reflected in COVERED_SETTINGS_KEYS).
 */
describe("settings field coverage", () => {
  it("every ClaudeSettingsSchema key has form coverage", () => {
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

describe("ccp capability settings coverage", () => {
  it("keeps every capability schema entry pre-seeded with intentional defaults", () => {
    expect({
      ids: CAPABILITY_IDS,
      schemaKeys: Object.keys(PersistedCapabilitiesSchema.shape),
      defaults: DEFAULT_CAPABILITIES,
    }).toStrictEqual({
      ids: ["readOnlyMcpServer", "workingCopyReview", "sessionContextBrief"],
      schemaKeys: ["readOnlyMcpServer", "workingCopyReview", "sessionContextBrief"],
      defaults: {
        readOnlyMcpServer: {
          enabled: false,
          config: { includePendingApprovals: true },
        },
        workingCopyReview: {
          enabled: true,
          config: { offerMode: "offer" },
        },
        sessionContextBrief: {
          enabled: false,
          config: { includeDecisions: true },
        },
      },
    });
  });
});
