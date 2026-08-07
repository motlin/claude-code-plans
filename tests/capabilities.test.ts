import { describe, expect, it } from "vite-plus/test";
import { workingCopyReviewDegradedMessage } from "../src/components/working-copy-review-banner";
import { capabilityVisible } from "../src/hooks/use-capabilities";
import {
  DEFAULT_CAPABILITIES,
  resolveServerCapabilities,
  type CapabilityRuntimeFactsById,
  type PersistedCapabilities,
} from "../src/lib/capabilities";
import { handleCapabilitiesRequest } from "../src/routes/api/capabilities";

const RUNTIME_FACTS: CapabilityRuntimeFactsById = {
  readOnlyMcpServer: { installed: true, available: true },
  workingCopyReview: { installed: true, available: false },
  sessionContextBrief: { installed: false, available: false },
};

describe("capability resolution", () => {
  it("offers working-copy reviews by default without enabling other optional capabilities", () => {
    expect(DEFAULT_CAPABILITIES).toStrictEqual({
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
    });
  });

  it("rejects malformed JSON without probing runtime capabilities", async () => {
    const probes: string[] = [];
    const response = await handleCapabilitiesRequest(
      new Request("http://127.0.0.1:7526/api/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }),
      {
        pathExists: async () => {
          probes.push("path");
          return true;
        },
        executableExists: async () => {
          probes.push("executable");
          return true;
        },
        databaseAvailable: async () => {
          probes.push("database");
          return true;
        },
        projectRoot: "/fixture/alice-repository",
      },
    );

    expect({ body: await response.json(), probes, status: response.status }).toStrictEqual({
      body: { error: "Invalid capabilities payload" },
      probes: [],
      status: 400,
    });
  });

  it("rejects incomplete persisted settings without throwing", async () => {
    const response = await handleCapabilitiesRequest(
      new Request("http://127.0.0.1:7526/api/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      {
        pathExists: async () => {
          throw new Error("invalid settings must not probe paths");
        },
        executableExists: async () => {
          throw new Error("invalid settings must not probe executables");
        },
        databaseAvailable: async () => {
          throw new Error("invalid settings must not probe the database");
        },
        projectRoot: "/fixture/alice-repository",
      },
    );

    expect({ body: await response.json(), status: response.status }).toStrictEqual({
      body: { error: "Invalid capabilities payload" },
      status: 400,
    });
  });

  it("keeps persisted intent separate from fresh runtime facts", () => {
    const persisted: PersistedCapabilities = {
      ...DEFAULT_CAPABILITIES,
      workingCopyReview: {
        ...DEFAULT_CAPABILITIES.workingCopyReview,
        enabled: false,
        config: { offerMode: "auto" },
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
        enabled: false,
        config: { offerMode: "auto" },
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
    const enabled = DEFAULT_CAPABILITIES;
    const disabled = {
      ...DEFAULT_CAPABILITIES,
      workingCopyReview: {
        ...DEFAULT_CAPABILITIES.workingCopyReview,
        enabled: false,
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
