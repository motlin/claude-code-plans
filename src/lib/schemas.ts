import {z} from 'zod';
import {isMcpTool, toolInputSchemas} from './tool-input-schemas';

// ---------------------------------------------------------------------------
// Sessions Index (sessions-index.json)
// ---------------------------------------------------------------------------

export const SessionIndexEntrySchema = z
	.object({
		sessionId: z.string(),
		fullPath: z.string(),
		fileMtime: z.number(),
		firstPrompt: z.string().optional(),
		summary: z.string().optional(),
		messageCount: z.number().optional(),
		created: z.string().optional(),
		modified: z.string().optional(),
		gitBranch: z.string().optional(),
		projectPath: z.string().optional(),
		isSidechain: z.boolean().optional(),
	})
	.passthrough();

export const SessionsIndexSchema = z
	.object({
		version: z.number(),
		entries: z.array(SessionIndexEntrySchema),
	})
	.passthrough();

// ---------------------------------------------------------------------------
// Content Blocks (inside user/assistant messages)
// ---------------------------------------------------------------------------

export const TextBlockSchema = z
	.object({
		type: z.literal('text'),
		text: z.string(),
	})
	.strict();

export const ToolUseBlockSchema = z
	.object({
		type: z.literal('tool_use'),
		id: z.string(),
		name: z.string(),
		input: z.record(z.string(), z.unknown()),
		caller: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
	})
	.strict();

export const ThinkingBlockSchema = z
	.object({
		type: z.literal('thinking'),
		thinking: z.string(),
		signature: z.string().optional(),
	})
	.strict();

export const ToolResultBlockSchema = z
	.object({
		type: z.literal('tool_result'),
		tool_use_id: z.string(),
		content: z.union([z.string(), z.array(z.unknown())]).optional(),
		is_error: z.boolean().optional(),
	})
	.strict();

export const ImageBlockSchema = z
	.object({
		type: z.literal('image'),
		source: z
			.object({
				type: z.string(),
				media_type: z.string(),
				data: z.string(),
			})
			.strict(),
	})
	.strict();

export const DocumentBlockSchema = z
	.object({
		type: z.literal('document'),
		source: z
			.object({
				type: z.string(),
				media_type: z.string(),
				data: z.string(),
			})
			.strict(),
	})
	.strict();

export const ContentBlockSchema = z
	.discriminatedUnion('type', [
		TextBlockSchema,
		ToolUseBlockSchema,
		ThinkingBlockSchema,
		ToolResultBlockSchema,
		ImageBlockSchema,
		DocumentBlockSchema,
	])
	.superRefine((block, ctx) => {
		if (block.type !== 'tool_use') return;

		const {name, input} = block;

		if (isMcpTool(name)) return;

		const schema = toolInputSchemas[name];
		if (!schema) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Unknown tool name: ${name}`,
				path: ['name'],
			});
			return;
		}

		const result = schema.safeParse(input);
		if (!result.success) {
			for (const issue of result.error.issues) {
				ctx.addIssue({
					...issue,
					path: ['input', ...issue.path],
				});
			}
		}
	});

// ---------------------------------------------------------------------------
// JSONL Record Types
// ---------------------------------------------------------------------------

// Shared fields present on most JSONL records (user, assistant, progress, system, attachment)
const BaseRecordFields = {
	uuid: z.string().optional(),
	timestamp: z.string().optional(),
	sessionId: z.string().optional(),
	parentUuid: z.union([z.string(), z.null()]).optional(),
	isSidechain: z.boolean().optional(),
	userType: z.string().optional(),
	cwd: z.string().optional(),
	gitBranch: z.string().optional(),
	slug: z.string().optional(),
	version: z.string().optional(),
	entrypoint: z.string().optional(),
	forkedFrom: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
	teamName: z.string().optional(),
};

export const UserRecordSchema = z
	.object({
		type: z.literal('user'),
		...BaseRecordFields,
		message: z
			.object({
				role: z.literal('user'),
				content: z.union([z.string(), z.array(ContentBlockSchema)]),
			})
			.strict(),
		toolUseResult: z.unknown().optional(),
		sourceToolAssistantUUID: z.string().optional(),
		sourceToolUseID: z.string().optional(),
		promptId: z.string().optional(),
		permissionMode: z.string().optional(),
		imagePasteIds: z.array(z.union([z.string(), z.number()])).optional(),
		isMeta: z.boolean().optional(),
		isCompactSummary: z.boolean().optional(),
		isVisibleInTranscriptOnly: z.boolean().optional(),
		mcpMeta: z.record(z.string(), z.unknown()).optional(),
		origin: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
	})
	.strict();

export const AssistantRecordSchema = z
	.object({
		type: z.literal('assistant'),
		...BaseRecordFields,
		requestId: z.string().optional(),
		message: z
			.object({
				role: z.literal('assistant'),
				model: z.string().optional(),
				id: z.string().optional(),
				type: z.string().optional(),
				content: z.union([z.string(), z.array(ContentBlockSchema)]),
				stop_reason: z.union([z.string(), z.null()]).optional(),
				stop_sequence: z.union([z.string(), z.null()]).optional(),
				usage: z.record(z.string(), z.unknown()).optional(),
				stop_details: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
				container: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
				context_management: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
			})
			.strict(),
		isApiErrorMessage: z.boolean().optional(),
		error: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
	})
	.strict();

export const CustomTitleRecordSchema = z
	.object({
		type: z.literal('custom-title'),
		customTitle: z.string(),
		sessionId: z.string(),
	})
	.strict();

export const FileHistorySnapshotSchema = z
	.object({
		type: z.literal('file-history-snapshot'),
		messageId: z.string().optional(),
		isSnapshotUpdate: z.boolean().optional(),
		snapshot: z
			.object({
				messageId: z.string().optional(),
				timestamp: z.string().optional(),
				trackedFileBackups: z.record(z.string(), z.unknown()),
			})
			.strict(),
	})
	.strict();

// ---------------------------------------------------------------------------
// Attachment sub-types (discriminated on attachment.type)
// ---------------------------------------------------------------------------

export const PlanModeAttachmentPayload = z
	.object({
		type: z.literal('plan_mode'),
		planFilePath: z.string().optional(),
		reminderType: z.string().optional(),
		isSubAgent: z.boolean().optional(),
		planExists: z.boolean().optional(),
	})
	.strict();

export const PlanModeExitAttachmentPayload = z
	.object({
		type: z.literal('plan_mode_exit'),
		planFilePath: z.string().optional(),
		planExists: z.boolean().optional(),
	})
	.strict();

// Fields shared by all hook attachment payloads
const HookBaseFields = {
	hookName: z.string(),
	toolUseID: z.string().optional(),
	hookEvent: z.string(),
};

export const HookSuccessAttachmentPayload = z
	.object({
		type: z.literal('hook_success'),
		...HookBaseFields,
		content: z.string().optional(),
		stdout: z.string().optional(),
		stderr: z.string().optional(),
		exitCode: z.number().optional(),
		command: z.string().optional(),
		durationMs: z.number().optional(),
	})
	.strict();

export const HookNonBlockingErrorAttachmentPayload = z
	.object({
		type: z.literal('hook_non_blocking_error'),
		...HookBaseFields,
		stderr: z.string().optional(),
		stdout: z.string().optional(),
		exitCode: z.number().optional(),
		command: z.string().optional(),
		durationMs: z.number().optional(),
	})
	.strict();

export const HookBlockingErrorAttachmentPayload = z
	.object({
		type: z.literal('hook_blocking_error'),
		...HookBaseFields,
		blockingError: z.record(z.string(), z.unknown()).optional(),
		command: z.string().optional(),
		durationMs: z.number().optional(),
	})
	.strict();

export const HookCancelledAttachmentPayload = z
	.object({
		type: z.literal('hook_cancelled'),
		...HookBaseFields,
		command: z.string().optional(),
		durationMs: z.number().optional(),
	})
	.strict();

export const HookAdditionalContextAttachmentPayload = z
	.object({
		type: z.literal('hook_additional_context'),
		...HookBaseFields,
		content: z.union([z.string(), z.array(z.unknown())]).optional(),
	})
	.strict();

export const DeferredToolsDeltaAttachmentPayload = z
	.object({
		type: z.literal('deferred_tools_delta'),
		addedNames: z.array(z.string()).optional(),
		addedLines: z.array(z.string()).optional(),
		removedNames: z.array(z.string()).optional(),
	})
	.strict();

export const McpInstructionsDeltaAttachmentPayload = z
	.object({
		type: z.literal('mcp_instructions_delta'),
		addedNames: z.array(z.string()).optional(),
		addedBlocks: z.array(z.string()).optional(),
		removedNames: z.array(z.string()).optional(),
	})
	.strict();

export const SkillListingAttachmentPayload = z
	.object({
		type: z.literal('skill_listing'),
		content: z.string().optional(),
		skillCount: z.number().optional(),
		isInitial: z.boolean().optional(),
	})
	.strict();

// Fields shared by task/todo reminder payloads
const ReminderBaseFields = {
	content: z.union([z.string(), z.array(z.unknown())]).optional(),
	itemCount: z.number().optional(),
};

export const TaskReminderAttachmentPayload = z
	.object({type: z.literal('task_reminder'), ...ReminderBaseFields})
	.strict();

export const TodoReminderAttachmentPayload = z
	.object({type: z.literal('todo_reminder'), ...ReminderBaseFields})
	.strict();

export const EditedTextFileAttachmentPayload = z
	.object({
		type: z.literal('edited_text_file'),
		filename: z.string(),
		snippet: z.string().optional(),
	})
	.strict();

export const FileAttachmentPayload = z
	.object({
		type: z.literal('file'),
		filename: z.string(),
		content: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
		displayPath: z.string().optional(),
	})
	.strict();

export const DirectoryAttachmentPayload = z
	.object({
		type: z.literal('directory'),
		path: z.string().optional(),
		content: z.string().optional(),
		displayPath: z.string().optional(),
	})
	.strict();

export const CompactFileReferenceAttachmentPayload = z
	.object({
		type: z.literal('compact_file_reference'),
		filename: z.string().optional(),
		displayPath: z.string().optional(),
	})
	.strict();

export const DateChangeAttachmentPayload = z
	.object({
		type: z.literal('date_change'),
		newDate: z.string(),
	})
	.strict();

export const CommandPermissionsAttachmentPayload = z
	.object({
		type: z.literal('command_permissions'),
		allowedTools: z.array(z.unknown()).optional(),
		model: z.string().optional(),
	})
	.strict();

export const DiagnosticsAttachmentPayload = z
	.object({
		type: z.literal('diagnostics'),
		files: z.array(z.unknown()).optional(),
		isNew: z.boolean().optional(),
	})
	.strict();

export const QueuedCommandAttachmentPayload = z
	.object({
		type: z.literal('queued_command'),
		prompt: z.union([z.string(), z.array(z.unknown())]).optional(),
		commandMode: z.string().optional(),
		imagePasteIds: z.array(z.union([z.string(), z.number()])).optional(),
		origin: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
	})
	.strict();

export const SelectedLinesInIdeAttachmentPayload = z
	.object({
		type: z.literal('selected_lines_in_ide'),
		ideName: z.string().optional(),
		lineStart: z.number().optional(),
		lineEnd: z.number().optional(),
		filename: z.string().optional(),
		content: z.string().optional(),
		displayPath: z.string().optional(),
	})
	.strict();

export const OpenedFileInIdeAttachmentPayload = z
	.object({
		type: z.literal('opened_file_in_ide'),
		filename: z.string().optional(),
	})
	.strict();

export const CompanionIntroAttachmentPayload = z
	.object({
		type: z.literal('companion_intro'),
		name: z.string().optional(),
		species: z.string().optional(),
	})
	.strict();

export const InvokedSkillsAttachmentPayload = z
	.object({
		type: z.literal('invoked_skills'),
		skills: z.array(z.unknown()).optional(),
	})
	.strict();

export const UltrathinkEffortAttachmentPayload = z
	.object({
		type: z.literal('ultrathink_effort'),
		level: z.string().optional(),
	})
	.strict();

export const AttachmentPayloadSchema = z.discriminatedUnion('type', [
	PlanModeAttachmentPayload,
	PlanModeExitAttachmentPayload,
	HookSuccessAttachmentPayload,
	HookNonBlockingErrorAttachmentPayload,
	HookBlockingErrorAttachmentPayload,
	HookCancelledAttachmentPayload,
	HookAdditionalContextAttachmentPayload,
	DeferredToolsDeltaAttachmentPayload,
	McpInstructionsDeltaAttachmentPayload,
	SkillListingAttachmentPayload,
	TaskReminderAttachmentPayload,
	TodoReminderAttachmentPayload,
	EditedTextFileAttachmentPayload,
	FileAttachmentPayload,
	DirectoryAttachmentPayload,
	CompactFileReferenceAttachmentPayload,
	DateChangeAttachmentPayload,
	CommandPermissionsAttachmentPayload,
	DiagnosticsAttachmentPayload,
	QueuedCommandAttachmentPayload,
	SelectedLinesInIdeAttachmentPayload,
	OpenedFileInIdeAttachmentPayload,
	CompanionIntroAttachmentPayload,
	InvokedSkillsAttachmentPayload,
	UltrathinkEffortAttachmentPayload,
]);

/**
 * Attachment record: uses discriminated union on attachment.type
 * for all the different attachment payloads.
 */
export const AttachmentRecordSchema = z
	.object({
		type: z.literal('attachment'),
		...BaseRecordFields,
		attachment: AttachmentPayloadSchema,
	})
	.strict();

export const ProgressRecordSchema = z
	.object({
		type: z.literal('progress'),
		...BaseRecordFields,
		data: z.record(z.string(), z.unknown()).optional(),
		toolUseID: z.string().optional(),
		parentToolUseID: z.string().optional(),
	})
	.strict();

export const SystemRecordSchema = z
	.object({
		type: z.literal('system'),
		...BaseRecordFields,
		subtype: z.string().optional(),
		durationMs: z.number().optional(),
		content: z.string().optional(),
		level: z.string().optional(),
		isMeta: z.boolean().optional(),
		toolUseID: z.string().optional(),
		sourceToolUseID: z.string().optional(),
		hookCount: z.number().optional(),
		hookInfos: z.array(z.unknown()).optional(),
		hookErrors: z.array(z.unknown()).optional(),
		preventedContinuation: z.boolean().optional(),
		stopReason: z.string().optional(),
		hasOutput: z.boolean().optional(),
		error: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
		messageCount: z.number().optional(),
		promptId: z.string().optional(),
		permissionMode: z.string().optional(),
		logicalParentUuid: z.string().optional(),
		cause: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
		compactMetadata: z.record(z.string(), z.unknown()).optional(),
		retryAttempt: z.number().optional(),
		retryInMs: z.number().optional(),
		maxRetries: z.number().optional(),
	})
	.strict();

export const LastPromptRecordSchema = z
	.object({
		type: z.literal('last-prompt'),
		lastPrompt: z.string(),
		sessionId: z.string(),
	})
	.strict();

export const QueueOperationRecordSchema = z
	.object({
		type: z.literal('queue-operation'),
		operation: z.string(),
		timestamp: z.string().optional(),
		sessionId: z.string().optional(),
		content: z.string().optional(),
	})
	.strict();

export const AgentNameRecordSchema = z
	.object({
		type: z.literal('agent-name'),
		agentName: z.string(),
		sessionId: z.string(),
	})
	.strict();

export const PermissionModeRecordSchema = z
	.object({
		type: z.literal('permission-mode'),
		permissionMode: z.string(),
		sessionId: z.string(),
	})
	.strict();

export const PrLinkRecordSchema = z
	.object({
		type: z.literal('pr-link'),
		prUrl: z.string(),
		prNumber: z.number(),
		prRepository: z.string(),
		sessionId: z.string(),
		timestamp: z.string().optional(),
	})
	.strict();

export const AgentColorRecordSchema = z
	.object({
		type: z.literal('agent-color'),
		agentColor: z.string(),
		sessionId: z.string(),
	})
	.strict();

/**
 * Discriminated union of all known JSONL record types.
 * Unknown record types are hard errors -- they mean we need a new schema branch.
 */
export const JsonlRecordSchema = z.discriminatedUnion('type', [
	UserRecordSchema,
	AssistantRecordSchema,
	CustomTitleRecordSchema,
	FileHistorySnapshotSchema,
	AttachmentRecordSchema,
	ProgressRecordSchema,
	SystemRecordSchema,
	LastPromptRecordSchema,
	QueueOperationRecordSchema,
	AgentNameRecordSchema,
	PermissionModeRecordSchema,
	PrLinkRecordSchema,
	AgentColorRecordSchema,
]);

// ---------------------------------------------------------------------------
// Task Files (~/.claude/tasks/{project}/{id}.json)
// ---------------------------------------------------------------------------

export const TaskStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

export const TaskFileSchema = z
	.object({
		id: z.string(),
		subject: z.string(),
		description: z.string(),
		status: TaskStatusSchema,
		blocks: z.array(z.string()),
		blockedBy: z.array(z.string()),
		activeForm: z.string().optional(),
	})
	.passthrough();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionIndexEntry = z.infer<typeof SessionIndexEntrySchema>;
export type SessionsIndex = z.infer<typeof SessionsIndexSchema>;
export type CustomTitleRecord = z.infer<typeof CustomTitleRecordSchema>;
export type FileHistorySnapshot = z.infer<typeof FileHistorySnapshotSchema>;
export type AttachmentRecord = z.infer<typeof AttachmentRecordSchema>;
export type TextBlock = z.infer<typeof TextBlockSchema>;
export type ToolUseBlock = z.infer<typeof ToolUseBlockSchema>;
export type ThinkingBlock = z.infer<typeof ThinkingBlockSchema>;
export type ToolResultBlock = z.infer<typeof ToolResultBlockSchema>;
export type ImageBlock = z.infer<typeof ImageBlockSchema>;
export type DocumentBlock = z.infer<typeof DocumentBlockSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type UserRecord = z.infer<typeof UserRecordSchema>;
export type AssistantRecord = z.infer<typeof AssistantRecordSchema>;
export type ProgressRecord = z.infer<typeof ProgressRecordSchema>;
export type SystemRecord = z.infer<typeof SystemRecordSchema>;
export type LastPromptRecord = z.infer<typeof LastPromptRecordSchema>;
export type QueueOperationRecord = z.infer<typeof QueueOperationRecordSchema>;
export type AgentNameRecord = z.infer<typeof AgentNameRecordSchema>;
export type PermissionModeRecord = z.infer<typeof PermissionModeRecordSchema>;
export type PrLinkRecord = z.infer<typeof PrLinkRecordSchema>;
export type AttachmentPayload = z.infer<typeof AttachmentPayloadSchema>;
export type JsonlRecord = z.infer<typeof JsonlRecordSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskFile = z.infer<typeof TaskFileSchema>;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Parse a single JSONL line into a typed record.
 * Returns null for empty/malformed lines.
 */
export function parseJsonlRecord(line: string): JsonlRecord | null {
	const trimmed = line.trim();
	if (!trimmed) return null;

	let obj: unknown;
	try {
		obj = JSON.parse(trimmed);
	} catch {
		return null;
	}

	const result = JsonlRecordSchema.safeParse(obj);
	if (!result.success) return null;
	return result.data;
}
