import { z } from "zod";

export const CAPABILITY_IDS = [
  "readOnlyMcpServer",
  "workingCopyReview",
  "sessionContextBrief",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

const ReadOnlyMcpServerConfigSchema = z
  .object({
    includePendingApprovals: z.boolean(),
  })
  .strict();

const WorkingCopyReviewConfigSchema = z
  .object({
    offerMode: z.enum(["offer", "auto"]),
  })
  .strict();

const SessionContextBriefConfigSchema = z
  .object({
    includeDecisions: z.boolean(),
  })
  .strict();

export const PersistedCapabilitiesSchema = z
  .object({
    readOnlyMcpServer: z
      .object({
        enabled: z.boolean(),
        config: ReadOnlyMcpServerConfigSchema,
      })
      .strict(),
    workingCopyReview: z
      .object({
        enabled: z.boolean(),
        config: WorkingCopyReviewConfigSchema,
      })
      .strict(),
    sessionContextBrief: z
      .object({
        enabled: z.boolean(),
        config: SessionContextBriefConfigSchema,
      })
      .strict(),
  })
  .strict();

export type PersistedCapabilities = z.infer<typeof PersistedCapabilitiesSchema>;

export const DEFAULT_CAPABILITIES: PersistedCapabilities = {
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
};

const CapabilityRuntimeFactsSchema = z
  .object({
    installed: z.boolean(),
    available: z.boolean(),
  })
  .strict();

const CapabilityRuntimeFactsByIdSchema = z
  .object({
    readOnlyMcpServer: CapabilityRuntimeFactsSchema,
    workingCopyReview: CapabilityRuntimeFactsSchema,
    sessionContextBrief: CapabilityRuntimeFactsSchema,
  })
  .strict();

export type CapabilityRuntimeFactsById = z.infer<typeof CapabilityRuntimeFactsByIdSchema>;

export const CapabilitiesSchema = z
  .object({
    readOnlyMcpServer: PersistedCapabilitiesSchema.shape.readOnlyMcpServer.extend({
      installed: z.boolean(),
      available: z.boolean(),
    }),
    workingCopyReview: PersistedCapabilitiesSchema.shape.workingCopyReview.extend({
      installed: z.boolean(),
      available: z.boolean(),
    }),
    sessionContextBrief: PersistedCapabilitiesSchema.shape.sessionContextBrief.extend({
      installed: z.boolean(),
      available: z.boolean(),
    }),
  })
  .strict();

export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/** Server boundary: combine persisted intent with fresh host and runtime facts. */
export function resolveServerCapabilities(
  persisted: PersistedCapabilities,
  runtimeFacts: CapabilityRuntimeFactsById,
): Capabilities {
  return CapabilitiesSchema.parse({
    readOnlyMcpServer: { ...persisted.readOnlyMcpServer, ...runtimeFacts.readOnlyMcpServer },
    workingCopyReview: { ...persisted.workingCopyReview, ...runtimeFacts.workingCopyReview },
    sessionContextBrief: { ...persisted.sessionContextBrief, ...runtimeFacts.sessionContextBrief },
  });
}

export function capabilityIsEnabled(
  capabilities: PersistedCapabilities,
  capabilityId: CapabilityId,
): boolean {
  return capabilities[capabilityId].enabled;
}
