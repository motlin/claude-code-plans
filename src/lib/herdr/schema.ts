import { z } from "zod";

const NonnegativeIntegerSchema = z.number().int().nonnegative();

/**
 * Drift-tolerant parsers for the external herdr wire protocol.
 *
 * Unlike ccp-owned API schemas, these objects are deliberately loose. Herdr's
 * Rust types are not `#[non_exhaustive]`, its protocol changes frequently, and
 * field-level drift exists between installed releases. Unknown fields and agent
 * statuses must therefore degrade gracefully instead of making ccp unavailable.
 * Regenerate the source schema from the running server version with
 * `herdr api schema --json` and update these selected shapes from that output.
 */

type HerdrAgentStatus = "idle" | "working" | "blocked" | "done" | "unknown" | (string & {});

const HerdrAgentStatusSchema: z.ZodType<HerdrAgentStatus> = z.string();

const HerdrAgentSessionSchema = z
  .object({
    source: z.string(),
    agent: z.string(),
    kind: z.enum(["id", "path"]),
    value: z.string(),
  })
  .loose();

const HerdrPaneScrollSchema = z
  .object({
    offset_from_bottom: NonnegativeIntegerSchema,
    max_offset_from_bottom: NonnegativeIntegerSchema,
    viewport_rows: NonnegativeIntegerSchema,
  })
  .loose();

export const HerdrPaneInfoSchema = z
  .object({
    pane_id: z.string(),
    terminal_id: z.string(),
    workspace_id: z.string(),
    tab_id: z.string(),
    focused: z.boolean(),
    cwd: z.string().nullish(),
    foreground_cwd: z.string().nullish(),
    agent: z.string().nullish(),
    agent_status: HerdrAgentStatusSchema,
    agent_session: HerdrAgentSessionSchema.nullish(),
    display_agent: z.string().nullish(),
    state_labels: z.record(z.string(), z.string()).optional(),
    title: z.string().nullish(),
    tokens: z.record(z.string(), z.string().nullable()).optional(),
    terminal_title: z.string().nullish(),
    scroll: HerdrPaneScrollSchema.nullish(),
    revision: NonnegativeIntegerSchema,
  })
  .loose();

export const HerdrPaneInfoResultSchema = z
  .object({
    type: z.literal("pane_info"),
    pane: HerdrPaneInfoSchema,
  })
  .loose();

const HerdrWorkspaceInfoSchema = z
  .object({
    workspace_id: z.string(),
    number: NonnegativeIntegerSchema,
    label: z.string(),
    focused: z.boolean(),
    pane_count: NonnegativeIntegerSchema,
    tab_count: NonnegativeIntegerSchema,
    active_tab_id: z.string(),
    agent_status: HerdrAgentStatusSchema,
    tokens: z.record(z.string(), z.string()).optional(),
    worktree: z
      .object({
        repo_key: z.string(),
        repo_name: z.string(),
        repo_root: z.string(),
        checkout_path: z.string(),
        is_linked_worktree: z.boolean(),
      })
      .loose()
      .nullish(),
  })
  .loose();

const HerdrTabInfoSchema = z
  .object({
    tab_id: z.string(),
    workspace_id: z.string(),
    number: NonnegativeIntegerSchema,
    label: z.string(),
    focused: z.boolean(),
    pane_count: NonnegativeIntegerSchema,
    agent_status: HerdrAgentStatusSchema,
  })
  .loose();

const HerdrPaneLayoutRectSchema = z
  .object({
    x: NonnegativeIntegerSchema,
    y: NonnegativeIntegerSchema,
    width: NonnegativeIntegerSchema,
    height: NonnegativeIntegerSchema,
  })
  .loose();

const HerdrPaneLayoutSchema = z
  .object({
    workspace_id: z.string(),
    tab_id: z.string(),
    zoomed: z.boolean(),
    area: HerdrPaneLayoutRectSchema,
    focused_pane_id: z.string(),
    panes: z.array(
      z
        .object({
          pane_id: z.string(),
          focused: z.boolean(),
          rect: HerdrPaneLayoutRectSchema,
        })
        .loose(),
    ),
    splits: z.array(
      z
        .object({
          id: z.string(),
          direction: z.enum(["right", "down"]),
          ratio: z.number(),
          rect: HerdrPaneLayoutRectSchema,
        })
        .loose(),
    ),
  })
  .loose();

const HerdrAgentInfoSchema = z
  .object({
    terminal_id: z.string(),
    agent_status: HerdrAgentStatusSchema,
    workspace_id: z.string(),
    tab_id: z.string(),
    pane_id: z.string(),
    focused: z.boolean(),
    revision: NonnegativeIntegerSchema,
    agent: z.string().nullish(),
    agent_session: HerdrAgentSessionSchema.nullish(),
    cwd: z.string().nullish(),
    display_agent: z.string().nullish(),
    foreground_cwd: z.string().nullish(),
    interactive_ready: z.boolean().optional(),
    launch_pending: z.boolean().optional(),
    name: z.string().nullish(),
    screen_detection_skipped: z.boolean().optional(),
    state_change_seq: NonnegativeIntegerSchema.optional(),
    state_labels: z.record(z.string(), z.string()).optional(),
    terminal_title: z.string().nullish(),
    terminal_title_stripped: z.string().nullish(),
    title: z.string().nullish(),
    tokens: z.record(z.string(), z.string()).optional(),
  })
  .loose();

export const HerdrPongResultSchema = z
  .object({
    type: z.literal("pong"),
    version: z.string(),
    protocol: NonnegativeIntegerSchema,
    capabilities: z
      .object({
        live_handoff: z.boolean(),
        detached_server_daemon: z.boolean().optional(),
      })
      .loose()
      .nullish(),
  })
  .loose();

export const HerdrSessionSnapshotResultSchema = z
  .object({
    type: z.literal("session_snapshot"),
    snapshot: z
      .object({
        version: z.string(),
        protocol: NonnegativeIntegerSchema,
        workspaces: z.array(HerdrWorkspaceInfoSchema),
        tabs: z.array(HerdrTabInfoSchema),
        panes: z.array(HerdrPaneInfoSchema),
        layouts: z.array(HerdrPaneLayoutSchema),
        agents: z.array(HerdrAgentInfoSchema),
        focused_workspace_id: z.string().nullish(),
        focused_tab_id: z.string().nullish(),
        focused_pane_id: z.string().nullish(),
      })
      .loose(),
  })
  .loose();

export const HerdrErrorBodySchema = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .loose();

export const HerdrPaneAgentStatusChangedEventSchema = z
  .object({
    type: z.literal("pane_agent_status_changed"),
    pane_id: z.string(),
    workspace_id: z.string(),
    agent_status: HerdrAgentStatusSchema,
    agent: z.string().nullish(),
    display_agent: z.string().nullish(),
    state_labels: z.record(z.string(), z.string()).optional(),
    title: z.string().nullish(),
  })
  .loose();
