import {z} from 'zod';

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
		offset: z.number().optional(),
		limit: z.number().optional(),
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
		file_path: z.string(),
		content: z.string(),
	})
	.strict();

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
		'-i': z.boolean().optional(),
		output_mode: z.string().optional(),
		'-A': z.number().optional(),
		'-B': z.number().optional(),
		'-C': z.number().optional(),
		'-n': z.boolean().optional(),
		head_limit: z.number().optional(),
		offset: z.number().optional(),
		multiline: z.boolean().optional(),
		context: z.number().optional(),
	})
	.strict();

export const AgentInputSchema = z
	.object({
		prompt: z.string(),
		description: z.string().optional(),
		subagent_type: z.string().optional(),
		isolation: z.string().optional(),
		mode: z.string().optional(),
		model: z.string().optional(),
		name: z.string().optional(),
		run_in_background: z.boolean().optional(),
		team_name: z.string().optional(),
	})
	.strict();

export const WebFetchInputSchema = z
	.object({
		url: z.string(),
		prompt: z.string().optional(),
	})
	.strict();

export const SkillInputSchema = z
	.object({
		skill: z.string(),
		args: z.string().optional(),
	})
	.strict();

export const TaskCreateInputSchema = z
	.object({
		subject: z.string(),
		description: z.string().optional(),
		status: z.string().optional(),
		blocks: z.array(z.string()).optional(),
		blockedBy: z.array(z.string()).optional(),
		activeForm: z.string().optional(),
	})
	.strict();

export const TaskUpdateInputSchema = z
	.object({
		taskId: z.string(),
		status: z.string().optional(),
		subject: z.string().optional(),
		description: z.string().optional(),
		activeForm: z.string().optional(),
		addBlockedBy: z.array(z.string()).optional(),
	})
	.strict();

export const TaskGetInputSchema = z
	.object({
		taskId: z.string(),
	})
	.strict();

export const TaskListInputSchema = z.object({}).strict();

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
			.array(
				z
					.object({
						question: z.string(),
						options: z.array(OptionSchema),
						multiSelect: z.boolean().optional(),
						header: z.string().optional(),
						preview: z.union([z.string(), z.null()]).optional(),
					})
					.strict(),
			)
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

export const EnterPlanModeInputSchema = z.object({}).strict();

export const ToolSearchInputSchema = z
	.object({
		query: z.string(),
		max_results: z.number().optional(),
	})
	.strict();

export const TodoWriteInputSchema = z
	.object({
		todos: z.array(z.unknown()),
	})
	.strict();

export const WebSearchInputSchema = z
	.object({
		query: z.string(),
		allowed_domains: z.array(z.string()).optional(),
	})
	.strict();

export const SendMessageInputSchema = z
	.object({
		to: z.string().optional(),
		recipient: z.string().optional(),
		message: z.string().optional(),
		content: z.string().optional(),
		type: z.string().optional(),
		prompt: z.string().optional(),
		summary: z.string().optional(),
	})
	.strict();

export const TaskStopInputSchema = z
	.object({
		task_id: z.string(),
	})
	.strict();

export const CronCreateInputSchema = z
	.object({
		cron: z.string(),
		prompt: z.string(),
		recurring: z.boolean().optional(),
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
	CronCreate: CronCreateInputSchema,
};

// MCP tool inputs vary by server — skip strict validation for them.
export function isMcpTool(name: string): boolean {
	return name.startsWith('mcp__');
}
