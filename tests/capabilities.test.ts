import { describe, expect, it, vi } from "vite-plus/test";
import { workingCopyReviewDegradedMessage } from "../src/components/working-copy-review-banner";
import { capabilityVisible, resolveCapabilityFlags } from "../src/hooks/use-capabilities";
import {
  DEFAULT_CAPABILITIES,
  resolveServerCapabilities,
  type CapabilityRuntimeFactsById,
  type PersistedCapabilities,
} from "../src/lib/capabilities";
import { DatabaseSchemaTooNewError } from "../src/lib/db/connection";
import { handleCapabilitiesRequest } from "../src/routes/api/capabilities";

const RUNTIME_FACTS: CapabilityRuntimeFactsById = {
  readOnlyMcpServer: { installed: true, available: true, unavailabilityReason: null },
  workingCopyReview: {
    installed: true,
    available: false,
    unavailabilityReason: { type: "claude-not-found" },
  },
  sessionContextBrief: { installed: false, available: false, unavailabilityReason: null },
};

function capabilitiesRequest(): Request {
  return new Request("http://127.0.0.1:7526/api/capabilities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(DEFAULT_CAPABILITIES),
  });
}

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
        unavailabilityReason: null,
      },
      workingCopyReview: {
        enabled: false,
        config: { offerMode: "auto" },
        installed: true,
        available: false,
        unavailabilityReason: { type: "claude-not-found" },
      },
      sessionContextBrief: {
        enabled: false,
        config: { includeDecisions: true },
        installed: false,
        available: false,
        unavailabilityReason: null,
      },
    });
  });

  it("reports a newer database schema ahead of a missing Claude executable", async () => {
    const databaseError = new DatabaseSchemaTooNewError(27, 26);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleCapabilitiesRequest(capabilitiesRequest(), {
      pathExists: async () => true,
      executableExists: async () => false,
      databaseAvailable: async () => {
        throw databaseError;
      },
      projectRoot: "/fixture/alice-repository",
    });

    expect({
      body: await response.json(),
      errorLog: errorLog.mock.calls,
      status: response.status,
    }).toStrictEqual({
      body: {
        readOnlyMcpServer: {
          enabled: false,
          config: { includePendingApprovals: true },
          installed: true,
          available: false,
          unavailabilityReason: {
            type: "database-schema-too-new",
            databaseSchemaVersion: 27,
            applicationSchemaVersion: 26,
          },
        },
        workingCopyReview: {
          enabled: true,
          config: { offerMode: "offer" },
          installed: true,
          available: false,
          unavailabilityReason: {
            type: "database-schema-too-new",
            databaseSchemaVersion: 27,
            applicationSchemaVersion: 26,
          },
        },
        sessionContextBrief: {
          enabled: false,
          config: { includeDecisions: true },
          installed: true,
          available: false,
          unavailabilityReason: {
            type: "database-schema-too-new",
            databaseSchemaVersion: 27,
            applicationSchemaVersion: 26,
          },
        },
      },
      errorLog: [["Capability database probe failed:", databaseError]],
      status: 200,
    });
    errorLog.mockRestore();
  });

  it("reports a missing Claude executable when the database is available", async () => {
    const response = await handleCapabilitiesRequest(capabilitiesRequest(), {
      pathExists: async () => true,
      executableExists: async () => false,
      databaseAvailable: async () => true,
      projectRoot: "/fixture/alice-repository",
    });

    expect({ body: await response.json(), status: response.status }).toStrictEqual({
      body: {
        readOnlyMcpServer: {
          enabled: false,
          config: { includePendingApprovals: true },
          installed: true,
          available: true,
          unavailabilityReason: null,
        },
        workingCopyReview: {
          enabled: true,
          config: { offerMode: "offer" },
          installed: true,
          available: false,
          unavailabilityReason: { type: "claude-not-found" },
        },
        sessionContextBrief: {
          enabled: false,
          config: { includeDecisions: true },
          installed: true,
          available: true,
          unavailabilityReason: null,
        },
      },
      status: 200,
    });
  });

  it("reports a generic database failure without hiding the successful executable probe", async () => {
    const databaseError = new Error("Test database unavailable");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleCapabilitiesRequest(capabilitiesRequest(), {
      pathExists: async () => true,
      executableExists: async () => true,
      databaseAvailable: async () => {
        throw databaseError;
      },
      projectRoot: "/fixture/alice-repository",
    });

    expect({
      body: await response.json(),
      errorLog: errorLog.mock.calls,
      status: response.status,
    }).toStrictEqual({
      body: {
        readOnlyMcpServer: {
          enabled: false,
          config: { includePendingApprovals: true },
          installed: true,
          available: false,
          unavailabilityReason: { type: "database-unavailable" },
        },
        workingCopyReview: {
          enabled: true,
          config: { offerMode: "offer" },
          installed: true,
          available: false,
          unavailabilityReason: { type: "database-unavailable" },
        },
        sessionContextBrief: {
          enabled: false,
          config: { includeDecisions: true },
          installed: true,
          available: false,
          unavailabilityReason: { type: "database-unavailable" },
        },
      },
      errorLog: [["Capability database probe failed:", databaseError]],
      status: 200,
    });
    errorLog.mockRestore();
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

  it("keeps pending and query-error states distinct from confirmed runtime failures", () => {
    const requestError = new Error("Capability request failed");

    expect([
      resolveCapabilityFlags(DEFAULT_CAPABILITIES, true, {
        data: undefined,
        isPending: true,
        error: null,
      }),
      resolveCapabilityFlags(DEFAULT_CAPABILITIES, true, {
        data: undefined,
        isPending: false,
        error: requestError,
      }),
    ]).toStrictEqual([
      {
        loaded: true,
        pending: true,
        error: null,
        states: {
          readOnlyMcpServer: {
            enabled: false,
            config: { includePendingApprovals: true },
            installed: true,
            available: false,
            unavailabilityReason: null,
          },
          workingCopyReview: {
            enabled: true,
            config: { offerMode: "offer" },
            installed: true,
            available: false,
            unavailabilityReason: null,
          },
          sessionContextBrief: {
            enabled: false,
            config: { includeDecisions: true },
            installed: true,
            available: false,
            unavailabilityReason: null,
          },
        },
        showReadOnlyMcpServer: false,
        showWorkingCopyReview: true,
        showSessionContextBrief: false,
      },
      {
        loaded: true,
        pending: false,
        error: requestError,
        states: {
          readOnlyMcpServer: {
            enabled: false,
            config: { includePendingApprovals: true },
            installed: true,
            available: false,
            unavailabilityReason: null,
          },
          workingCopyReview: {
            enabled: true,
            config: { offerMode: "offer" },
            installed: true,
            available: false,
            unavailabilityReason: null,
          },
          sessionContextBrief: {
            enabled: false,
            config: { includeDecisions: true },
            installed: true,
            available: false,
            unavailabilityReason: null,
          },
        },
        showReadOnlyMcpServer: false,
        showWorkingCopyReview: true,
        showSessionContextBrief: false,
      },
    ]);
  });

  it("renders a message for every confirmed working-copy review failure", () => {
    expect([
      workingCopyReviewDegradedMessage({
        ...DEFAULT_CAPABILITIES.workingCopyReview,
        enabled: true,
        installed: false,
        available: false,
        unavailabilityReason: null,
      }),
      workingCopyReviewDegradedMessage({
        ...DEFAULT_CAPABILITIES.workingCopyReview,
        enabled: true,
        installed: true,
        available: false,
        unavailabilityReason: { type: "claude-not-found" },
      }),
      workingCopyReviewDegradedMessage({
        ...DEFAULT_CAPABILITIES.workingCopyReview,
        enabled: true,
        installed: true,
        available: false,
        unavailabilityReason: {
          type: "database-schema-too-new",
          databaseSchemaVersion: 27,
          applicationSchemaVersion: 26,
        },
      }),
      workingCopyReviewDegradedMessage({
        ...DEFAULT_CAPABILITIES.workingCopyReview,
        enabled: true,
        installed: true,
        available: false,
        unavailabilityReason: { type: "database-unavailable" },
      }),
      workingCopyReviewDegradedMessage({
        ...DEFAULT_CAPABILITIES.workingCopyReview,
        enabled: true,
        installed: true,
        available: false,
        unavailabilityReason: null,
      }),
      workingCopyReviewDegradedMessage({
        ...DEFAULT_CAPABILITIES.workingCopyReview,
        enabled: true,
        installed: true,
        available: true,
        unavailabilityReason: null,
      }),
    ]).toStrictEqual([
      "Working-copy review is enabled, but its review skill is not installed.",
      "Working-copy review is enabled, but the Claude executable was not found. Install Claude Code or add claude to PATH, then restart just dev.",
      "Working-copy review is enabled, but database schema version 27 is newer than application schema version 26. Check out a revision that supports schema version 27, then restart just dev.",
      "Working-copy review is enabled, but its database is unavailable. Check the server logs, then restart just dev.",
      null,
      null,
    ]);
  });
});
