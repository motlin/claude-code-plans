import {z} from 'zod';
import {
	BashInputSchema,
	ReadInputSchema,
	EditInputSchema,
	MultiEditInputSchema,
	WriteInputSchema,
	GlobInputSchema,
	GrepInputSchema,
	AgentInputSchema,
	WebFetchInputSchema,
	TodoWriteInputSchema,
	ExitPlanModeInputSchema,
	AskUserQuestionInputSchema,
} from './tool-input-schemas';

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

/**
 * Non-domain SSE event names that are not file-level deltas. Session lifecycle
 * (start/end) stays here because it carries server-side state transitions, and
 * the worktree / statusline / catch-all content events are not tied to any
 * domain entity diff. Everything that used to be a file-system-level event
 * (session:update, sessions:reindexed, task:updated, plan:updated,
 * memory:updated) now lives exclusively in DOMAIN_EVENTS below.
 */
export const SSE_EVENTS = {
	SESSION_START: 'session:start',
	SESSION_END: 'session:end',
	WORKTREE_CREATED: 'worktree:created',
	STATUSLINE_UPDATED: 'statusline:updated',
	CONTENT_UPDATED: 'content:updated',
} as const;

/**
 * Domain-level delta events. Payloads carry the data needed to patch the
 * TanStack Query cache client-side without a refetch. The server is
 * responsible for diffing old vs new state and emitting these events.
 */
export const DOMAIN_EVENTS = {
	SESSION_ADDED: 'session:added',
	SESSION_REMOVED: 'session:removed',
	SESSION_UPDATED: 'session:updated',
	SESSION_STARTED: 'session:started',
	SESSION_ENDED: 'session:ended',
	SESSION_LINES_APPENDED: 'session:lines-appended',
	PLAN_CHANGED: 'plan:changed',
	PLAN_REMOVED: 'plan:removed',
	MEMORY_CHANGED: 'memory:changed',
	MEMORY_REMOVED: 'memory:removed',
	TASK_CHANGED: 'task:changed',
	TASK_COMPLETED: 'task:completed',
	APPROVAL_CHANGED: 'approval:changed',
	APPROVAL_RESOLVED: 'approval:resolved',
} as const;

// ---------------------------------------------------------------------------
// SSE Event Payloads (sent to client)
// ---------------------------------------------------------------------------

/**
 * Summary payload for a single session, matching the serialized shape
 * emitted by the `/api/sessions` endpoint. Dates are ISO strings so payloads
 * survive JSON serialization to clients.
 */
export interface SessionSummaryPayload {
	id: string;
	title: string;
	summary: string | undefined;
	mtime: string;
	created: string;
	project: string;
	projectName: string;
	messageCount: number;
	gitBranch: string | undefined;
	starred: boolean;
}

/**
 * Payload describing a session that is currently blocked waiting for the user
 * to answer an `ExitPlanMode` or `AskUserQuestion` tool call. `blockedSince` is
 * an ISO string so the payload survives JSON serialization to clients.
 */
export interface PendingApprovalPayload {
	sessionId: string;
	projectId: string;
	projectName: string;
	toolName: 'ExitPlanMode' | 'AskUserQuestion';
	toolUseId: string;
	blockedSince: string;
	planFilename: string | null;
	questionPreview: string | null;
}

/** Summary payload for a single plan, matching `/api/plans` output. */
export interface PlanSummaryPayload {
	filename: string;
	title: string;
	mtime: string;
}

/** Summary payload for a single memory file. */
export interface MemorySummaryPayload {
	filename: string;
	title: string;
	mtime: string;
	project: string;
	projectName: string;
}

/** Summary payload for a single task, matching the TaskRow shape. */
export interface TaskSummaryPayload {
	taskId: string;
	projectDir: string;
	subject: string;
	description: string;
	status: string;
	activeForm: string | null;
	blocks: string[];
	blockedBy: string[];
}

/** Active session info for session:started — matches ActiveSession shape. */
export interface ActiveSessionPayload {
	sessionId: string;
	cwd: string;
	model: string;
	startedAt: number;
	lastActivity: number;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | {[key: string]: JsonValue};

export interface SessionLinesAppendedPayload {
	sessionId: string;
	lines: Record<string, JsonValue>[];
}

// ---------------------------------------------------------------------------
// Diff helpers for domain-event broadcasting
// ---------------------------------------------------------------------------

/**
 * Diff two keyed maps of entities and return the added/removed/updated sets.
 * `equals` controls whether two entries with the same key count as "updated"
 * — defaults to strict `===` reference equality, which is almost never what
 * callers want; pass a value-level comparator.
 */
export function diffEntityMaps<T>(
	previous: ReadonlyMap<string, T>,
	next: ReadonlyMap<string, T>,
	equals: (a: T, b: T) => boolean = Object.is,
): {added: T[]; removed: string[]; updated: T[]} {
	const added: T[] = [];
	const removed: string[] = [];
	const updated: T[] = [];

	for (const [key, value] of next) {
		const prior = previous.get(key);
		if (prior === undefined) {
			added.push(value);
		} else if (!equals(prior, value)) {
			updated.push(value);
		}
	}

	for (const key of previous.keys()) {
		if (!next.has(key)) removed.push(key);
	}

	return {added, removed, updated};
}

// ---------------------------------------------------------------------------
// Claude Hook Event Schemas (received from hooks via POST /api/hook)
// ---------------------------------------------------------------------------

/**
 * Fields present on every hook event Claude Code sends. The docs ship
 * `session_id`, `transcript_path`, `cwd`, and `hook_event_name` on every event.
 * `claude_env` is the merged snapshot of CLAUDE-prefixed environment variables
 * the jq filter in `hook-config.ts` attaches to every payload before POSTing.
 */
const BaseHookFields = {
	session_id: z.string(),
	transcript_path: z.string(),
	cwd: z.string(),
	hook_event_name: z.string(),
	claude_env: z.record(z.string(), z.string()).optional(),
} as const;

// ---------------------------------------------------------------------------
// Per-tool strict schemas for PostToolUse / PreToolUse discriminated union.
// Each entry pairs a strict `tool_input` with a strict `tool_response`. The
// response shapes are derived from the renderer types in
// `src/components/tool-renderers/types.ts` and the JSONL fixtures under
// `tests/fixtures/`.
// ---------------------------------------------------------------------------

const BashToolResponseSchema = z
	.object({
		stdout: z.string().optional(),
		stderr: z.string().optional(),
		interrupted: z.boolean().optional(),
		isImage: z.boolean().optional(),
		sandbox: z.boolean().optional(),
		returnCodeInterpretation: z.string().optional(),
	})
	.strict();

const ReadToolResponseSchema = z
	.object({
		type: z.string().optional(),
		file: z
			.object({
				filePath: z.string().optional(),
				content: z.string().optional(),
				numLines: z.number().optional(),
				startLine: z.number().optional(),
				totalLines: z.number().optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

const EditToolResponseSchema = z
	.object({
		filePath: z.string().optional(),
		oldString: z.string().optional(),
		newString: z.string().optional(),
		originalFile: z.string().optional(),
		structuredPatch: z.array(z.unknown()).optional(),
		userModified: z.boolean().optional(),
		replaceAll: z.boolean().optional(),
	})
	.strict();

const MultiEditToolResponseSchema = z
	.object({
		filePath: z.string().optional(),
		edits: z.array(z.unknown()).optional(),
		originalFileContents: z.string().optional(),
		structuredPatch: z.array(z.unknown()).optional(),
		userModified: z.boolean().optional(),
	})
	.strict();

const WriteToolResponseSchema = z
	.object({
		type: z.string().optional(),
		filePath: z.string().optional(),
		content: z.string().optional(),
		structuredPatch: z.array(z.unknown()).optional(),
	})
	.strict();

const GlobToolResponseSchema = z
	.object({
		filenames: z.array(z.string()).optional(),
		durationMs: z.number().optional(),
		numFiles: z.number().optional(),
		truncated: z.boolean().optional(),
	})
	.strict();

const GrepToolResponseSchema = z
	.object({
		mode: z.string().optional(),
		filenames: z.array(z.string()).optional(),
		content: z.string().optional(),
		numFiles: z.number().optional(),
		numLines: z.number().optional(),
	})
	.strict();

const TaskToolResponseSchema = z
	.object({
		content: z.array(z.unknown()).optional(),
		totalTokens: z.number().optional(),
		totalToolUseCount: z.number().optional(),
		wasInterrupted: z.boolean().optional(),
	})
	.strict();

const WebFetchToolResponseSchema = z
	.object({
		url: z.string().optional(),
		bytes: z.number().optional(),
		code: z.number().optional(),
		codeText: z.string().optional(),
		result: z.string().optional(),
		durationMs: z.number().optional(),
	})
	.strict();

const TodoWriteToolResponseSchema = z
	.object({
		oldTodos: z.array(z.unknown()).optional(),
		newTodos: z.array(z.unknown()).optional(),
	})
	.strict();

const ExitPlanModeToolResponseSchema = z
	.object({
		plan: z.string().optional(),
		approved: z.boolean().optional(),
	})
	.strict();

const AskUserQuestionToolResponseSchema = z
	.object({
		answers: z.array(z.unknown()).optional(),
		answer: z.string().optional(),
	})
	.strict();

/**
 * Discriminated union over `tool_name` for every tool variant we render. Each
 * branch carries a strict `tool_input` and strict `tool_response`. New tools
 * are detected by the schema-drift recovery path in `routes/api/hook.ts` so
 * they fail loud instead of being silently accepted.
 */
const ToolUseUnion = z.discriminatedUnion('tool_name', [
	z.strictObject({
		tool_name: z.literal('Bash'),
		tool_input: BashInputSchema,
		tool_response: BashToolResponseSchema.optional(),
	}),
	z.strictObject({
		tool_name: z.literal('Read'),
		tool_input: ReadInputSchema,
		tool_response: ReadToolResponseSchema.optional(),
	}),
	z.strictObject({
		tool_name: z.literal('Edit'),
		tool_input: EditInputSchema,
		tool_response: EditToolResponseSchema.optional(),
	}),
	z.strictObject({
		tool_name: z.literal('MultiEdit'),
		tool_input: MultiEditInputSchema,
		tool_response: MultiEditToolResponseSchema.optional(),
	}),
	z.strictObject({
		tool_name: z.literal('Write'),
		tool_input: WriteInputSchema,
		tool_response: WriteToolResponseSchema.optional(),
	}),
	z.strictObject({
		tool_name: z.literal('Glob'),
		tool_input: GlobInputSchema,
		tool_response: GlobToolResponseSchema.optional(),
	}),
	z.strictObject({
		tool_name: z.literal('Grep'),
		tool_input: GrepInputSchema,
		tool_response: GrepToolResponseSchema.optional(),
	}),
	z.strictObject({
		tool_name: z.literal('Task'),
		tool_input: AgentInputSchema,
		tool_response: TaskToolResponseSchema.optional(),
	}),
	z.strictObject({
		tool_name: z.literal('WebFetch'),
		tool_input: WebFetchInputSchema,
		tool_response: WebFetchToolResponseSchema.optional(),
	}),
	z.strictObject({
		tool_name: z.literal('TodoWrite'),
		tool_input: TodoWriteInputSchema,
		tool_response: TodoWriteToolResponseSchema.optional(),
	}),
	z.strictObject({
		tool_name: z.literal('ExitPlanMode'),
		tool_input: ExitPlanModeInputSchema,
		tool_response: ExitPlanModeToolResponseSchema.optional(),
	}),
	z.strictObject({
		tool_name: z.literal('AskUserQuestion'),
		tool_input: AskUserQuestionInputSchema,
		tool_response: AskUserQuestionToolResponseSchema.optional(),
	}),
]);

const SessionStartHookEvent = z.strictObject({
	...BaseHookFields,
	hook_event_name: z.literal('SessionStart'),
	source: z.enum(['startup', 'resume', 'clear', 'compact']),
	model: z.string().optional(),
});

const SessionEndHookEvent = z.strictObject({
	...BaseHookFields,
	hook_event_name: z.literal('SessionEnd'),
	reason: z.string().optional(),
});

const StopHookEvent = z.strictObject({
	...BaseHookFields,
	hook_event_name: z.literal('Stop'),
	stop_hook_active: z.boolean().optional(),
});

const SubagentStopHookEvent = z.strictObject({
	...BaseHookFields,
	hook_event_name: z.literal('SubagentStop'),
	stop_hook_active: z.boolean().optional(),
});

const UserPromptSubmitHookEvent = z.strictObject({
	...BaseHookFields,
	hook_event_name: z.literal('UserPromptSubmit'),
	prompt: z.string(),
});

const NotificationHookEvent = z.strictObject({
	...BaseHookFields,
	hook_event_name: z.literal('Notification'),
	message: z.string(),
	title: z.string().optional(),
});

const PreCompactHookEvent = z.strictObject({
	...BaseHookFields,
	hook_event_name: z.literal('PreCompact'),
	trigger: z.enum(['manual', 'auto']).optional(),
	custom_instructions: z.string().optional(),
});

/**
 * Build a strict `PreToolUse` / `PostToolUse` variant union. The outer
 * `HookEventEnvelope` discriminates on `hook_event_name`, so we cannot keep a
 * nested `tool_name` discriminated union as a child of a single
 * `PreToolUse` / `PostToolUse` variant — `z.union` of these is the closest
 * strict alternative. Each option is a strict object that pins both
 * `hook_event_name` and `tool_name` to a literal.
 */
function buildToolUseEvent(eventName: 'PreToolUse' | 'PostToolUse') {
	const variants = ToolUseUnion.options.map((toolVariant) =>
		z.strictObject({
			...BaseHookFields,
			hook_event_name: z.literal(eventName),
			tool_name: toolVariant.shape.tool_name,
			tool_input: toolVariant.shape.tool_input,
			tool_response: toolVariant.shape.tool_response,
		}),
	);
	return z.union(variants as [(typeof variants)[number], ...typeof variants]);
}

const PreToolUseHookEvent = buildToolUseEvent('PreToolUse');
const PostToolUseHookEvent = buildToolUseEvent('PostToolUse');

const TaskCompletedHookEvent = z.strictObject({
	...BaseHookFields,
	hook_event_name: z.literal('TaskCompleted'),
	task_id: z.string().optional(),
	task_subject: z.string().optional(),
	task_description: z.string().optional(),
});

const WorktreeCreateHookEvent = z.strictObject({
	...BaseHookFields,
	hook_event_name: z.literal('WorktreeCreate'),
	name: z.string().optional(),
});

/**
 * Union over every hook event Claude Code can send. Each variant is a strict
 * object — unknown fields fail parsing and trigger the schema-drift recovery
 * path in `src/routes/api/hook.ts`. `PreToolUse` and `PostToolUse` are
 * themselves unions over per-tool strict variants (see `ToolUseUnion`).
 *
 * The outer discriminator (`hook_event_name`) cannot be expressed via
 * `z.discriminatedUnion` because the `PreToolUse` / `PostToolUse` arms are
 * already discriminated unions (Zod's discriminatedUnion only accepts plain
 * object schemas). `z.union` matches the same set of payloads and still emits
 * useful per-arm errors.
 */
export const HookEventEnvelope = z.union([
	SessionStartHookEvent,
	SessionEndHookEvent,
	StopHookEvent,
	SubagentStopHookEvent,
	UserPromptSubmitHookEvent,
	NotificationHookEvent,
	PreCompactHookEvent,
	PreToolUseHookEvent,
	PostToolUseHookEvent,
	TaskCompletedHookEvent,
	WorktreeCreateHookEvent,
]);

export type HookEvent = z.infer<typeof HookEventEnvelope>;
export type HookEventName = HookEvent['hook_event_name'];

/**
 * The set of hook event names handled by the receiver, derived directly from
 * the discriminated union above so there's no second list to keep in sync.
 * Each variant declares `hook_event_name: z.literal('...')` — we read that
 * literal back out of the schema definition. `PreToolUse` / `PostToolUse` are
 * `ZodIntersection`s so we hand-list them; everything else is read from the
 * strict envelope.
 */
export const KNOWN_HOOK_EVENTS: readonly HookEventName[] = [
	'SessionStart',
	'SessionEnd',
	'Stop',
	'SubagentStop',
	'UserPromptSubmit',
	'Notification',
	'PreCompact',
	'PreToolUse',
	'PostToolUse',
	'TaskCompleted',
	'WorktreeCreate',
];
