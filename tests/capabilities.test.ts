import { describe, expect, it } from "vite-plus/test";
import { workingCopyReviewDegradedMessage } from "../src/components/working-copy-review-banner";
import { capabilityVisible } from "../src/hooks/use-capabilities";
import {
  DEFAULT_CAPABILITIES,
  resolveServerCapabilities,
  type CapabilityRuntimeFactsById,
} from "../src/lib/capabilities";

const RUNTIME_FACTS: CapabilityRuntimeFactsById = {
  readOnlyMcpServer: { installed: true, available: true },
  workingCopyReview: { installed: true, available: false },
  sessionContextBrief: { installed: false, available: false },
};

describe("capability resolution", () => {
  it("keeps persisted intent separate from fresh runtime facts", () => {
    const persisted = {
      ...DEFAULT_CAPABILITIES,
      workingCopyReview: {
        ...DEFAULT_CAPABILITIES.workingCopyReview,
        enabled: true,
      },
    };

    expect(resolveServerCapabilities(persisted, RUNTIME_FACTS)).toStrictEqual({
      readOnlyMcpServer: {
        enabled: false,
        config: { includePendingApprovals: true },
        installed: true,
        available: true,
      },
      workingCopyReview: {
        enabled: true,
        config: { offerMode: "offer" },
        installed: true,
        available: false,
      },
      sessionContextBrief: {
        enabled: false,
        config: { includeDecisions: true },
        installed: false,
        available: false,
      },
    });
  });

  it("keeps an enabled feature visible before load and while degraded", () => {
    const disabled = DEFAULT_CAPABILITIES;
    const enabled = {
      ...DEFAULT_CAPABILITIES,
      workingCopyReview: {
        ...DEFAULT_CAPABILITIES.workingCopyReview,
        enabled: true,
      },
    };

    expect([
      capabilityVisible(false, disabled, "workingCopyReview"),
      capabilityVisible(true, disabled, "workingCopyReview"),
      capabilityVisible(true, enabled, "workingCopyReview"),
    ]).toStrictEqual([true, false, true]);
  });

  it("shows a loud degraded message instead of hiding an enabled unavailable feature", () => {
    expect([
      workingCopyReviewDegradedMessage({
        ...DEFAULT_CAPABILITIES.workingCopyReview,
        enabled: true,
        installed: true,
        available: false,
      }),
      workingCopyReviewDegradedMessage({
        ...DEFAULT_CAPABILITIES.workingCopyReview,
        enabled: false,
        installed: true,
        available: false,
      }),
    ]).toStrictEqual([
      "Working-copy review is enabled, but its local runtime is unreachable.",
      null,
    ]);
  });
});
