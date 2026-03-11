import {z} from 'zod';

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

export type SessionIndexEntry = z.infer<typeof SessionIndexEntrySchema>;
export type SessionsIndex = z.infer<typeof SessionsIndexSchema>;
export type CustomTitleRecord = z.infer<typeof CustomTitleRecordSchema>;
export type FileHistorySnapshot = z.infer<typeof FileHistorySnapshotSchema>;
