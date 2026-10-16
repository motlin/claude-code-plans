import {z} from "zod";

import {normalizeQuestions, type QuestionLike} from "./ask-user-question";

export interface TranscriptPendingQuestion {
	toolUseId: string;
	questions: QuestionLike[];
}

const BlockSchema = z.object({
	type: z.string(),
	id: z.string().optional(),
	name: z.string().optional(),
	input: z.record(z.string(), z.unknown()).optional(),
	tool_use_id: z.string().optional(),
});

const RecordSchema = z.object({
	type: z.string(),
	isSidechain: z.boolean().optional(),
	message: z.object({content: z.union([z.string(), z.array(BlockSchema)]).optional()}).optional(),
});

export interface PendingToolUse {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

/** The main thread's last assistant tool_use when it has no tool_result yet, or null. */
export function findLastPendingToolUse(records: readonly unknown[]): PendingToolUse | null {
	let last: z.infer<typeof BlockSchema> | null = null;
	const answered = new Set<string>();
	for (const raw of records) {
		const parsed = RecordSchema.safeParse(raw);
		if (!parsed.success || parsed.data.isSidechain === true) continue;
		const content = parsed.data.message?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (parsed.data.type === "assistant" && block.type === "tool_use") last = block;
			if (block.type === "tool_result" && block.tool_use_id !== undefined) {
				answered.add(block.tool_use_id);
			}
		}
	}
	if (last?.id === undefined || last.name === undefined || answered.has(last.id)) return null;
	return {id: last.id, name: last.name, input: last.input ?? {}};
}

/**
 * The main thread's last assistant tool_use when it is an AskUserQuestion that
 * has no tool_result yet, or null: the question upstream draws inline as its card.
 */
export function findPendingAskUserQuestion(records: readonly unknown[]): TranscriptPendingQuestion | null {
	const pending = findLastPendingToolUse(records);
	if (pending?.name !== "AskUserQuestion") return null;
	const questions = normalizeQuestions(pending.input);
	return questions === null ? null : {toolUseId: pending.id, questions};
}
