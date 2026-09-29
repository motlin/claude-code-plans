import { z } from "zod";
import {
  ArtifactActionSchema,
  ArtifactAutoOpenSchema,
  ArtifactCapabilitiesSchema,
  ArtifactDbOpSchema,
  ArtifactIntentSchema,
  ArtifactListScopeSchema,
} from "./artifact-schemas";

const JsonInputValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonInputValueSchema),
    z.record(z.string(), JsonInputValueSchema),
  ]),
);

export const BashInputSchema = z
  .object({
    command: z.string(),
    description: z.string().optional(),
    timeout: z.number().optional(),
    run_in_background: z.boolean().optional(),
    dangerouslyDisableSandbox: z.boolean().optional(),
  })
  .strict();

export const ReadInputSchema = z
  .object({
    file_path: z.string(),
    offset: z.union([z.number(), z.string()]).optional(),
    limit: z.union([z.number(), z.string()]).optional(),
    pages: z.string().optional(),
  })
  .strict();

export const EditInputSchema = z
  .object({
    file_path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  })
  .strict();

export const MultiEditInputSchema = z
  .object({
    file_path: z.string(),
    edits: z.array(
      z
        .object({
          old_string: z.string(),
          new_string: z.string(),
          replace_all: z.boolean().optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const WriteInputSchema = z
  .object({
    file_path: z.string().optional(),
    content: z.string().optional(),
    path: z.string().optional(),
    data: z.string().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasCanonicalInput = input.file_path !== undefined || input.content !== undefined;
    const hasLegacyInput = input.path !== undefined || input.data !== undefined;
    const canonicalInputIsComplete = input.file_path !== undefined && input.content !== undefined;
    const legacyInputIsComplete = input.path !== undefined && input.data !== undefined;
    const pathContentInputIsComplete = input.path !== undefined && input.content !== undefined;

    if (canonicalInputIsComplete && !hasLegacyInput) return;
    if (legacyInputIsComplete && !hasCanonicalInput) return;
    if (pathContentInputIsComplete && input.file_path === undefined && input.data === undefined)
      return;

    ctx.addIssue({
      code: "custom",
      message: "Write input must include file_path/content, path/data, or path/content",
    });
  });

export const GlobInputSchema = z
  .object({
    pattern: z.string(),
    path: z.string().optional(),
  })
  .strict();

export const GrepInputSchema = z
  .object({
    pattern: z.string(),
    path: z.string().optional(),
    glob: z.string().optional(),
    type: z.string().optional(),
    "-i": z.boolean().optional(),
    output_mode: z.string().optional(),
    "-A": z.number().optional(),
    "-B": z.number().optional(),
    "-C": z.number().optional(),
    "-n": z.boolean().optional(),
    head_limit: z.number().optional(),
    offset: z.number().optional(),
    multiline: z.boolean().optional(),
    context: z.number().optional(),
  })
  .strict();

export const AgentInputSchema = z
  .object({
    prompt: z.string().optional(),
    description: z.string().optional(),
    subagent_type: z.string().optional(),
    agentType: z.string().optional(),
    label: z.string().optional(),
    isolation: z.string().optional(),
    mode: z.string().optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
    name: z.string().optional(),
    run_in_background: z.boolean().optional(),
    team_name: z.string().optional(),
    parameter: z.string().optional(),
  })
  .strict();

const WebFetchInputSchema = z
  .object({
    url: z.string(),
    prompt: z.string().optional(),
  })
  .strict();

const SkillInputSchema = z
  .object({
    skill: z.string(),
    args: z.string().optional(),
  })
  .strict();

const TaskCreateInputSchema = z
  .object({
    subject: z.string().optional(),
    description: z.string().optional(),
    status: z.string().optional(),
    blocks: z.array(z.string()).optional(),
    blockedBy: z.array(z.string()).optional(),
    activeForm: z.string().optional(),
    agent_type: z.string().optional(),
    priority: z.string().optional(),
    metadata: z.union([z.string(), z.record(z.string(), JsonInputValueSchema)]).optional(),
  })
  .strict();

const TaskUpdateInputSchema = z
  .object({
    taskId: z.string().optional(),
    id: z.union([z.string(), z.number()]).optional(),
    status: z.string().optional(),
    subject: z.string().optional(),
    description: z.string().optional(),
    activeForm: z.string().optional(),
    addBlockedBy: z.array(z.string()).optional(),
    addBlocks: z.array(z.string()).optional(),
    owner: z.string().optional(),
    priority: z.string().optional(),
    metadata: z.union([z.string(), z.record(z.string(), JsonInputValueSchema)]).optional(),
  })
  .strict()
  .refine((input) => input.taskId !== undefined || input.id !== undefined, {
    message: "TaskUpdate input must include taskId or id",
  });

const TaskGetInputSchema = z
  .object({
    taskId: z.string().optional(),
    id: z.union([z.string(), z.number()]).optional(),
  })
  .strict()
  .refine((input) => input.taskId !== undefined || input.id !== undefined, {
    message: "TaskGet input must include taskId or id",
  });

const TaskListInputSchema = z
  .object({
    summary: z.string().optional(),
  })
  .strict();

const OptionSchema = z
  .object({
    label: z.string(),
    description: z.string().optional(),
    preview: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

const AskUserQuestionAnnotationSchema = z
  .object({
    notes: z.string().optional(),
    preview: z.string().optional(),
  })
  .strict();

const AskUserQuestionInputSchema = z
  .object({
    question: z.string().optional(),
    options: z.array(OptionSchema).optional(),
    questions: z
      .union([
        z.array(
          z
            .object({
              question: z.string(),
              options: z.array(OptionSchema),
              multiSelect: z.boolean().optional(),
              header: z.string().optional(),
              preview: z.union([z.string(), z.null()]).optional(),
            })
            .strict(),
        ),
        z.string(),
      ])
      .optional(),
    answers: z.record(z.string(), z.string()).optional(),
    annotations: z.record(z.string(), AskUserQuestionAnnotationSchema).optional(),
    multiSelect: z.boolean().optional(),
    header: z.string().optional(),
  })
  .strict();

/**
 * One pre-approved follow-up action attached to a plan: the tool the model may
 * call after approval, and a description of what it will do with it.
 */
export const ExitPlanModeAllowedPromptSchema = z
  .object({
    tool: z.string(),
    prompt: z.string(),
  })
  .strict();

const ExitPlanModeInputSchema = z
  .object({
    plan: z.string().optional(),
    planFilePath: z.string().optional(),
    allowedPrompts: z.array(ExitPlanModeAllowedPromptSchema).optional(),
  })
  .strict();

const EnterPlanModeInputSchema = z.object({}).strict();

const ToolSearchInputSchema = z
  .object({
    query: z.string(),
    max_results: z.number().optional(),
  })
  .strict();

const TodoWriteInputSchema = z
  .object({
    todos: z.union([z.array(z.unknown()), z.string()]),
  })
  .strict();

const WebSearchInputSchema = z
  .object({
    query: z.string(),
    allowed_domains: z.array(z.string()).optional(),
    blocked_domains: z.array(z.string()).optional(),
  })
  .strict();

const SendMessageInputSchema = z
  .object({
    to: z.string().optional(),
    recipient: z.string().optional(),
    message: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    content: z.string().optional(),
    type: z.string().optional(),
    prompt: z.string().optional(),
    summary: z.string().optional(),
    // Shutdown handshake between a team lead and its members.
    request_id: z.string().optional(),
    approve: z.boolean().optional(),
  })
  .strict();

const TaskStopInputSchema = z
  .object({
    task_id: z.string().optional(),
    shell_id: z.string().optional(),
  })
  .strict();

const CronCreateInputSchema = z
  .object({
    cron: z.string(),
    prompt: z.string(),
    recurring: z.boolean().optional(),
  })
  .strict();

const CronDeleteInputSchema = z
  .object({
    id: z.string().optional(),
    cron_id: z.string().optional(),
  })
  .strict();

const CronListInputSchema = z.object({}).strict();

const TeamCreateInputSchema = z
  .object({
    name: z.string().optional(),
    team_name: z.string().optional(),
    description: z.string().optional(),
    agent_type: z.string().optional(),
  })
  .strict();

const TeamDeleteInputSchema = z
  .object({
    name: z.string().optional(),
    team_name: z.string().optional(),
  })
  .strict();

const ScheduleWakeupInputSchema = z
  .object({
    delaySeconds: z.number().optional(),
    delay_seconds: z.number().optional(),
    delay: z.union([z.number(), z.string()]).optional(),
    timestamp: z.union([z.number(), z.string()]).optional(),
    cron: z.string().optional(),
    recurring: z.boolean().optional(),
    prompt: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

const EnterWorktreeInputSchema = z
  .object({
    name: z.string().optional(),
    path: z.string().optional(),
  })
  .strict();

const ExitWorktreeInputSchema = z
  .object({
    action: z.string().optional(),
    discard_changes: z.boolean().optional(),
  })
  .strict();

const TaskOutputInputSchema = z
  .object({
    task_id: z.string().optional(),
    shell_id: z.string().optional(),
    block: z.boolean().optional(),
    timeout: z.number().optional(),
  })
  .strict();

export const LSPInputSchema = z
  .object({
    file_path: z.string().optional(),
    path: z.string().optional(),
    line: z.number().optional(),
    character: z.number().optional(),
    symbol: z.string().optional(),
    method: z.string().optional(),
  })
  .strict();

export const NotebookEditInputSchema = z
  .object({
    notebook_path: z.string(),
    new_source: z.string(),
    cell_id: z.string().optional(),
    cell_type: z.string().optional(),
    edit_mode: z.string().optional(),
  })
  .strict();

const NotebookReadInputSchema = z
  .object({
    notebook_path: z.string(),
    cell_id: z.string().optional(),
  })
  .strict();

/** How sure a reviewer is that a reported finding is real (upstream "Confirmed" / "Plausible"). */
export const ReportFindingsVerdictSchema = z.enum(["CONFIRMED", "PLAUSIBLE"]);

export const ReportedFindingSchema = z
  .object({
    file: z.string(),
    line: z.number(),
    category: z.string().optional(),
    short_summary: z.string().optional(),
    summary: z.string(),
    failure_scenario: z.string(),
    verdict: ReportFindingsVerdictSchema.optional(),
  })
  .strict();

export const ReportFindingsInputSchema = z
  .object({
    level: z.string().optional(),
    findings: z.array(ReportedFindingSchema),
  })
  .strict();

const MonitorInputSchema = z
  .object({
    command: z.string().optional(),
    ws: z.strictObject({ url: z.string() }).optional(),
    description: z.string().optional(),
    timeout_ms: z.number().optional(),
    timeout: z.string().optional(),
    persistent: z.boolean().optional(),
  })
  .strict();

export const LSInputSchema = z
  .object({
    path: z.string(),
    ignore: z.array(z.string()).optional(),
  })
  .strict();

const ArtifactFileSourceSchema = z.union([
  z.string(),
  z.strictObject({ from: z.string(), contentType: z.string().optional() }),
  z.strictObject({ artifact: z.string(), path: z.string(), ver: z.string().optional() }),
  z.null(),
]);

/** Omitting `action` means publish; `read_db` is the older shape of the ArtifactData read. */
export const ArtifactInputSchema = z
  .object({
    action: ArtifactActionSchema.optional(),
    file_path: z.string().optional(),
    file_paths: z.array(z.string()).optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    label: z.string().optional(),
    note: z.string().optional(),
    icon: z.string().optional(),
    favicon: z.string().optional(),
    capabilities: ArtifactCapabilitiesSchema.optional(),
    files: z
      .union([
        z.record(z.string(), ArtifactFileSourceSchema),
        z.array(z.strictObject({ path: z.string(), contentType: z.string().optional() })),
      ])
      .optional(),
    root: z.string().optional(),
    pin: z.boolean().optional(),
    contract: z.string().optional(),
    force: z.boolean().optional(),
    overwrite_unread: z.array(z.string()).optional(),
    type_url: z.string().optional(),
    auto_open: ArtifactAutoOpenSchema.optional(),
    asset: z.boolean().optional(),
    from_url: z.string().optional(),
    asset_ids: z.array(z.string()).optional(),
    path: z.string().optional(),
    paths: z.array(z.string()).optional(),
    prompt: z.string().optional(),
    page: z.boolean().optional(),
    out_dir: z.string().optional(),
    limit: z.number().optional(),
    scope: ArtifactListScopeSchema.optional(),
    type: z.string().optional(),
    type_query: z.string().optional(),
    after: z.string().optional(),
    intent: ArtifactIntentSchema.optional(),
    design_systems: z.boolean().optional(),
    db_op: ArtifactDbOpSchema.optional(),
    collection: z.string().optional(),
    doc_id: z.string().optional(),
  })
  .strict();

export const toolInputSchemas = {
  Bash: BashInputSchema,
  Read: ReadInputSchema,
  Edit: EditInputSchema,
  MultiEdit: MultiEditInputSchema,
  Write: WriteInputSchema,
  Glob: GlobInputSchema,
  Grep: GrepInputSchema,
  Agent: AgentInputSchema,
  WebFetch: WebFetchInputSchema,
  Skill: SkillInputSchema,
  TaskCreate: TaskCreateInputSchema,
  TaskUpdate: TaskUpdateInputSchema,
  TaskGet: TaskGetInputSchema,
  TaskList: TaskListInputSchema,
  AskUserQuestion: AskUserQuestionInputSchema,
  ExitPlanMode: ExitPlanModeInputSchema,
  EnterPlanMode: EnterPlanModeInputSchema,
  ToolSearch: ToolSearchInputSchema,
  TodoWrite: TodoWriteInputSchema,
  WebSearch: WebSearchInputSchema,
  SendMessage: SendMessageInputSchema,
  TaskStop: TaskStopInputSchema,
  TaskOutput: TaskOutputInputSchema,
  Monitor: MonitorInputSchema,
  CronCreate: CronCreateInputSchema,
  CronDelete: CronDeleteInputSchema,
  CronList: CronListInputSchema,
  TeamCreate: TeamCreateInputSchema,
  TeamDelete: TeamDeleteInputSchema,
  ScheduleWakeup: ScheduleWakeupInputSchema,
  EnterWorktree: EnterWorktreeInputSchema,
  ExitWorktree: ExitWorktreeInputSchema,
  LSP: LSPInputSchema,
  NotebookEdit: NotebookEditInputSchema,
  NotebookRead: NotebookReadInputSchema,
  ReportFindings: ReportFindingsInputSchema,
  LS: LSInputSchema,
  Artifact: ArtifactInputSchema,
} satisfies Record<string, z.ZodType>;

// MCP tool inputs vary by server — skip strict validation for them.
export function isMcpTool(name: string): boolean {
  return name.startsWith("mcp__");
}
