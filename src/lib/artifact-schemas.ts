import { z } from "zod";

/**
 * Strict schemas for the `Artifact` tool (claude.ai artifact publishing).
 * Shapes come from real calls on disk (tests/fixtures/artifact-tool-samples.json)
 * plus the documented tool parameters; the input schema itself lives in
 * tool-input-schemas.ts and reuses the enums below.
 */

const JsonDataSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonDataSchema),
    z.record(z.string(), JsonDataSchema),
  ]),
);

export const ArtifactActionSchema = z.enum([
  "publish",
  "read",
  "list",
  "delete",
  "open",
  "pin",
  "unpin",
  "quickstart",
  "read_db",
]);

export const ArtifactIntentSchema = z.enum(["document", "slides", "design", "other"]);

export const ArtifactListScopeSchema = z.enum([
  "mine",
  "shared",
  "all",
  "types",
  "files",
  "assets",
]);

export const ArtifactAutoOpenSchema = z.enum(["at_create", "after_first_write"]);

export const ArtifactDbOpSchema = z.enum(["get", "list"]);

export const ArtifactLiveSubscriptionSchema = z.enum([
  "arming",
  "connected",
  "publish_context",
  "flag_off",
]);

export const ArtifactCapabilitiesSchema = z.strictObject({
  db: z.strictObject({}).optional(),
});

const ArtifactPublishResultSchema = z.strictObject({
  url: z.string(),
  path: z.string(),
  artifact_id: z.string().optional(),
  title: z.string(),
  updated: z.boolean(),
  icon: z.string().optional(),
  audience: z.string().optional(),
  seq: z.number().optional(),
  version: z.string(),
  capabilities: ArtifactCapabilitiesSchema.optional(),
  stored: z
    .strictObject({
      contract: z.string(),
      capabilities: ArtifactCapabilitiesSchema,
      carried: z.boolean().optional(),
      preferredContract: z.string(),
      read: z.string(),
    })
    .optional(),
  contract: z.string().optional(),
  liveSubscription: ArtifactLiveSubscriptionSchema,
});

const ArtifactTypeCreateResultSchema = z.strictObject({
  created_from_type: z.literal(true),
  url: z.string(),
  version: z.string(),
  title: z.string(),
  type: z.strictObject({ url: z.string(), release: z.string() }),
  own_files: z.array(z.string()),
  type_files: z.array(z.string()),
  provisioned: z
    .strictObject({
      store: z.string(),
      project_id: z.string(),
      file_id: z.string(),
      node_id: z.string(),
    })
    .optional(),
  auto_open: ArtifactAutoOpenSchema.optional(),
  liveSubscription: ArtifactLiveSubscriptionSchema,
  instructions: z.string(),
  instructions_chars: z.number(),
});

const ArtifactListResultSchema = z.strictObject({
  artifacts: z.array(
    z.strictObject({
      title: z.string(),
      url: z.string(),
      favicon: z.string().optional(),
      updatedAt: z.string(),
    }),
  ),
  truncated: z.boolean(),
});

const ArtifactReadResultSchema = z.strictObject({
  read: z.strictObject({
    bytes: z.number(),
    code: z.number(),
    codeText: z.string(),
    result: z.string(),
    durationMs: z.number(),
    url: z.string(),
  }),
  artifactRead: z.strictObject({ slug: z.string(), ver: z.string() }),
});

const ArtifactReadDbResultSchema = z.strictObject({
  db_read: z.strictObject({
    op: ArtifactDbOpSchema,
    collection: z.string(),
    doc_id: z.string().optional(),
    found: z.boolean().optional(),
    docs: z.array(
      z.strictObject({
        id: z.string(),
        // Documents hold whatever the artifact page stored; the shape is the page's own.
        data: z.record(z.string(), JsonDataSchema),
        version: z.number(),
        updatedAt: z.string(),
      }),
    ),
    saved: z
      .strictObject({
        dir: z.string(),
        files: z.array(
          z.strictObject({
            id: z.string(),
            path: z.string(),
            bytes: z.number(),
            version: z.number(),
            updatedAt: z.string(),
          }),
        ),
        skipped: z.array(z.string()),
      })
      .optional(),
  }),
});

const ArtifactQuickstartResultSchema = z.strictObject({
  quickstart: z.strictObject({
    intent: ArtifactIntentSchema,
    match: z.strictObject({
      title: z.string(),
      type_url: z.string(),
      description: z.string(),
      tier: z.string(),
    }),
  }),
});

/** A failed call records its error message as a plain string. */
const ArtifactErrorResultSchema = z.string();

/** `toolUseResult` of an `Artifact` tool call. */
export const ArtifactToolResultSchema = z.union([
  ArtifactPublishResultSchema,
  ArtifactTypeCreateResultSchema,
  ArtifactListResultSchema,
  ArtifactReadResultSchema,
  ArtifactReadDbResultSchema,
  ArtifactQuickstartResultSchema,
  ArtifactErrorResultSchema,
]);
