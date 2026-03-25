import {z} from 'zod';

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
	.passthrough();

export const ToolUseBlockSchema = z
	.object({
		type: z.literal('tool_use'),
		id: z.string(),
		name: z.string(),
		input: z.record(z.string(), z.unknown()),
	})
	.passthrough();

export const ThinkingBlockSchema = z
	.object({
		type: z.literal('thinking'),
		thinking: z.string(),
		signature: z.string().optional(),
	})
	.passthrough();

export const ToolResultBlockSchema = z
	.object({
		type: z.literal('tool_result'),
		tool_use_id: z.string(),
		content: z.union([z.string(), z.array(z.unknown())]).optional(),
		is_error: z.boolean().optional(),
	})
	.passthrough();

export const ContentBlockSchema = z.union([
	TextBlockSchema,
	ToolUseBlockSchema,
	ThinkingBlockSchema,
	ToolResultBlockSchema,
	z.object({type: z.string()}).passthrough(),
]);

// ---------------------------------------------------------------------------
// JSONL Record Types
// ---------------------------------------------------------------------------

// Shared fields present on most JSONL records (user, assistant, progress, system)
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
			.passthrough(),
	})
	.passthrough();

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
			})
			.passthrough(),
	})
	.passthrough();

export const CustomTitleRecordSchema = z
	.object({
		type: z.literal('custom-title'),
		customTitle: z.string(),
		sessionId: z.string(),
	})
	.passthrough();

export const FileHistorySnapshotSchema = z
	.object({
		type: z.literal('file-history-snapshot'),
		snapshot: z
			.object({
				trackedFileBackups: z.record(z.string(), z.unknown()),
			})
			.passthrough(),
	})
	.passthrough();

export const ProgressRecordSchema = z
	.object({
		type: z.literal('progress'),
		...BaseRecordFields,
		data: z.record(z.string(), z.unknown()).optional(),
		toolUseID: z.string().optional(),
		parentToolUseID: z.string().optional(),
	})
	.passthrough();

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
	})
	.passthrough();

export const LastPromptRecordSchema = z
	.object({
		type: z.literal('last-prompt'),
		lastPrompt: z.string(),
		sessionId: z.string(),
	})
	.passthrough();

export const QueueOperationRecordSchema = z
	.object({
		type: z.literal('queue-operation'),
		operation: z.string(),
		timestamp: z.string().optional(),
		sessionId: z.string().optional(),
		content: z.string().optional(),
	})
	.passthrough();

/**
 * Discriminated union of all known JSONL record types.
 * Falls back to a generic { type: string } for unknown types.
 */
export const JsonlRecordSchema = z.union([
	UserRecordSchema,
	AssistantRecordSchema,
	CustomTitleRecordSchema,
	FileHistorySnapshotSchema,
	ProgressRecordSchema,
	SystemRecordSchema,
	LastPromptRecordSchema,
	QueueOperationRecordSchema,
	z.object({type: z.string()}).passthrough(),
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
export type TextBlock = z.infer<typeof TextBlockSchema>;
export type ToolUseBlock = z.infer<typeof ToolUseBlockSchema>;
export type ThinkingBlock = z.infer<typeof ThinkingBlockSchema>;
export type ToolResultBlock = z.infer<typeof ToolResultBlockSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type UserRecord = z.infer<typeof UserRecordSchema>;
export type AssistantRecord = z.infer<typeof AssistantRecordSchema>;
export type ProgressRecord = z.infer<typeof ProgressRecordSchema>;
export type SystemRecord = z.infer<typeof SystemRecordSchema>;
export type LastPromptRecord = z.infer<typeof LastPromptRecordSchema>;
export type QueueOperationRecord = z.infer<typeof QueueOperationRecordSchema>;
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
