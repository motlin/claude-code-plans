import {z} from "zod";

import {normalizeQuestions, type QuestionLike} from "./ask-user-question";
import type {PendingQuestion} from "./hook-events";
import {asRecord} from "./narrow";
import type {SessionSummaryState} from "./session-state";

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
 * Every main-thread assistant tool_use with no tool_result yet, in record
 * order, once each: a re-written block keeps its first place. Most are running
 * or not reached yet; the CLI asks serial tools one at a time, in this order.
 */
export function findPendingToolUses(records: readonly unknown[]): PendingToolUse[] {
	const calls = new Map<string, PendingToolUse>();
	const answered = new Set<string>();
	for (const raw of records) {
		const parsed = RecordSchema.safeParse(raw);
		if (!parsed.success || parsed.data.isSidechain === true) continue;
		const content = parsed.data.message?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (
				parsed.data.type === "assistant" &&
				block.type === "tool_use" &&
				block.id !== undefined &&
				block.name !== undefined &&
				!calls.has(block.id)
			) {
				calls.set(block.id, {id: block.id, name: block.name, input: block.input ?? {}});
			}
			if (block.type === "tool_result" && block.tool_use_id !== undefined) {
				answered.add(block.tool_use_id);
			}
		}
	}
	return [...calls.values()].filter((call) => !answered.has(call.id));
}

/** The main thread's first unanswered tool_use: the call a serial batch's permission prompt asks about. */
export function findFirstPendingToolUse(records: readonly unknown[]): PendingToolUse | null {
	return findPendingToolUses(records)[0] ?? null;
}

/** A permission ask as its hook reports it: no tool_use id, only the tool and its input. */
export interface PermissionAsk {
	toolName: string;
	toolInput: unknown;
}

function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((item, index) => jsonEqual(item, b[index]))
		);
	}
	const left = asRecord(a);
	const right = asRecord(b);
	if (left === undefined || right === undefined) return false;
	const keys = Object.keys(left);
	return (
		keys.length === Object.keys(right).length &&
		keys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]))
	);
}

/** The first pending call the ask describes: the same tool with a deep-equal input. */
export function matchPendingToolUse(pending: readonly PendingToolUse[], ask: PermissionAsk): PendingToolUse | null {
	return pending.find((call) => call.name === ask.toolName && jsonEqual(call.input, ask.toolInput)) ?? null;
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

/** Where a main-thread tool call stands in the records: not written yet, awaiting its result, or answered. */
export type ToolUseProgress = "absent" | "pending" | "answered";

export function toolUseProgress(records: readonly unknown[], toolUseId: string): ToolUseProgress {
	let progress: ToolUseProgress = "absent";
	for (const raw of records) {
		const parsed = RecordSchema.safeParse(raw);
		if (!parsed.success || parsed.data.isSidechain === true) continue;
		const content = parsed.data.message?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (block.type === "tool_result" && block.tool_use_id === toolUseId) return "answered";
			if (parsed.data.type === "assistant" && block.type === "tool_use" && block.id === toolUseId) {
				progress = "pending";
			}
		}
	}
	return progress;
}

/**
 * Whether to draw the hook's copy of the session's question: the session waits
 * on it and its record is not on disk yet. Once the record lands the transcript
 * draws it, and the hook state lags behind the JSONL, so an answered record
 * must never bring the hook copy back as an unanswered card. A `sent` copy keeps
 * its receipt whatever the state, so a summary that flips to working before the
 * record lands never blanks it.
 */
export function hookQuestionCardShown({
	state,
	hookQuestion,
	records,
	sent,
}: {
	state: SessionSummaryState | null;
	hookQuestion: PendingQuestion | null | undefined;
	records: readonly unknown[];
	sent: boolean;
}): boolean {
	return (
		(state === "waiting" || sent) &&
		hookQuestion !== null &&
		hookQuestion !== undefined &&
		toolUseProgress(records, hookQuestion.toolUseId) === "absent"
	);
}

/** The hook's pending question, or null once the transcript already holds its answer. */
export function liveHookQuestion(
	hookQuestion: PendingQuestion | null | undefined,
	records: readonly unknown[],
): PendingQuestion | null | undefined {
	if (hookQuestion === null || hookQuestion === undefined) return hookQuestion;
	return toolUseProgress(records, hookQuestion.toolUseId) === "answered" ? null : hookQuestion;
}
