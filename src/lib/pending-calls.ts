import {z} from "zod";

// The AskUserQuestion and ExitPlanMode calls a session waits on, kept apart from the hook event schemas in
// `hook-events.ts` so the client API modules that parse them don't download those schemas.

/** One question of a pending AskUserQuestion call, trimmed to what the docked card shows. */
const PendingQuestionItemSchema = z.strictObject({
	question: z.string(),
	header: z.string().optional(),
	options: z.array(z.strictObject({label: z.string(), description: z.string().optional()})),
	multiSelect: z.boolean().optional(),
});
export type PendingQuestionItem = z.infer<typeof PendingQuestionItemSchema>;

/**
 * The AskUserQuestion call a session waits on, taken from its `PreToolUse`
 * hook: the CLI writes the call to the JSONL only once it is answered.
 */
export const PendingQuestionSchema = z.strictObject({
	toolUseId: z.string(),
	questions: z.array(PendingQuestionItemSchema),
});
export type PendingQuestion = z.infer<typeof PendingQuestionSchema>;

/** One question's answer from the docked card: the chosen option indexes and any Other text. */
export const QuestionAnswerSchema = z.strictObject({
	selected: z.array(z.number().int()),
	other: z.string().optional(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;

/** Payload broadcast when a session's pending AskUserQuestion appears or resolves. */
export interface SessionPendingQuestionChangedPayload {
	sessionId: string;
	pendingQuestion: PendingQuestion | null;
}

/**
 * The ExitPlanMode call a session waits on, taken from its `PreToolUse` or
 * `PermissionRequest` hook: the CLI writes the call to the JSONL only once the
 * plan is answered. `toolUseId` is "" when only the PermissionRequest, which
 * carries none, has been seen.
 */
export const PendingPlanSchema = z.strictObject({
	toolUseId: z.string(),
	plan: z.string(),
	planFilePath: z.string().optional(),
});
export type PendingPlan = z.infer<typeof PendingPlanSchema>;
