import { z } from "zod";

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

export const WebFetchInputSchema = z
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

export const AskUserQuestionInputSchema = z
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
    multiSelect: z.boolean().optional(),
    header: z.string().optional(),
  })
  .strict();

export const ExitPlanModeInputSchema = z
  .object({
    plan: z.string().optional(),
    planFilePath: z.string().optional(),
    allowedPrompts: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional(),
  })
  .strict();

const EnterPlanModeInputSchema = z.object({}).strict();

const ToolSearchInputSchema = z
  .object({
    query: z.string(),
    max_results: z.number().optional(),
  })
  .strict();

export const TodoWriteInputSchema = z
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

export const LSInputSchema = z
  .object({
    path: z.string(),
    ignore: z.array(z.string()).optional(),
  })
  .strict();

export const toolInputSchemas: Record<string, z.ZodType> = {
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
  LS: LSInputSchema,
};

// MCP tool inputs vary by server — skip strict validation for them.
export function isMcpTool(name: string): boolean {
  return name.startsWith("mcp__");
}
