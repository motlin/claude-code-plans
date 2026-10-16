import {z} from "zod";

import {
	QuestionAnswerSchema,
	type PendingQuestion,
	type PendingQuestionItem,
	type QuestionAnswer,
} from "../hook-events";
import {getPendingQuestion} from "../pending-question-store";
import {rejectCrossSite} from "../same-origin-guard";
import {herdrRequest, type HerdrResult} from "./client";
import type {HerdrRequester} from "./panes";
import {herdrWritesEnabled, resolveHerdrPromptTarget, type HerdrPromptTarget} from "./prompt";

const HerdrQuestionSchema = z.strictObject({
	sessionId: z.string().min(1),
	toolUseId: z.string().min(1),
	answers: z.array(QuestionAnswerSchema.nullable()).min(1),
});

export type QuestionAnswerStep = {key: string} | {text: string};

/** Other text on one line: a newline typed into the dialog would press Enter. */
function flattenOther(text: string | undefined): string {
	return (text ?? "").replace(/\s+/g, " ").trim();
}

function validSelection(question: PendingQuestionItem, answer: QuestionAnswer): boolean {
	const {selected} = answer;
	if (new Set(selected).size !== selected.length) return false;
	if (selected.some((index) => index < 0 || index >= question.options.length)) return false;
	if (question.multiSelect === true) return true;
	return selected.length + (flattenOther(answer.other) === "" ? 0 : 1) <= 1;
}

function repeat(key: string, times: number): QuestionAnswerStep[] {
	return Array.from({length: times}, () => ({key}));
}

/**
 * The keys that answer the CLI's AskUserQuestion dialog. Each question opens
 * with the cursor on its first option, rows 1…n are the options and n+1 is
 * "Type something". A single-select digit picks and moves on; a multi-select
 * digit toggles in place, so the walk goes down to the Next/Submit row below
 * Other. Several questions, or any multi-select, end on a review page whose
 * "1. Submit answers" sends them; a lone single-select question has none, so
 * skipping it cancels with Esc. Null when the answers do not fit the questions.
 */
export function questionAnswerSteps(
	questions: readonly PendingQuestionItem[],
	answers: ReadonlyArray<QuestionAnswer | null>,
): QuestionAnswerStep[] | null {
	if (answers.length !== questions.length) return null;
	const loneSingleSelect = questions.length === 1 && questions[0]?.multiSelect !== true;
	const steps: QuestionAnswerStep[] = [];
	for (const [index, question] of questions.entries()) {
		const answer = answers[index] ?? null;
		if (answer !== null && !validSelection(question, answer)) return null;
		const optionCount = question.options.length;
		const selected = answer?.selected ?? [];
		const other = flattenOther(answer?.other);
		if (question.multiSelect === true) {
			steps.push(...selected.map((option) => ({key: String(option + 1)})));
			if (other === "") {
				steps.push(...repeat("down", optionCount + 1));
			} else {
				steps.push(...repeat("down", optionCount), {text: other}, {key: "down"});
			}
			steps.push({key: "enter"});
		} else if (selected[0] !== undefined) {
			steps.push({key: String(selected[0] + 1)});
		} else if (other !== "") {
			steps.push({key: String(optionCount + 1)}, {text: other}, {key: "enter"});
		} else if (loneSingleSelect) {
			return [{key: "esc"}];
		} else {
			steps.push({key: "tab"});
		}
	}
	if (!loneSingleSelect) steps.push({key: "1"});
	return steps;
}

export interface HerdrQuestionDependencies {
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	pendingQuestion: (sessionId: string) => PendingQuestion | null;
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	request: HerdrRequester;
	createRequestId: () => string;
	/** Waits between steps so the TUI reads each key as its own press. */
	pause: () => Promise<void>;
}

const STEP_PAUSE_MS = 80;

export const defaultHerdrQuestionDependencies: HerdrQuestionDependencies = {
	rejectRequest: rejectCrossSite,
	writesEnabled: herdrWritesEnabled,
	pendingQuestion: getPendingQuestion,
	resolveTarget: async (sessionId) => resolveHerdrPromptTarget(sessionId),
	request: herdrRequest,
	createRequestId: () => `ccp:question:${crypto.randomUUID()}`,
	pause: async () =>
		new Promise((resolve) => {
			setTimeout(resolve, STEP_PAUSE_MS);
		}),
};

function stepCall(paneId: string, step: QuestionAnswerStep): {method: string; params: Record<string, unknown>} {
	return "key" in step
		? {method: "agent.send_keys", params: {target: paneId, keys: [step.key]}}
		: {method: "pane.send_text", params: {pane_id: paneId, text: step.text}};
}

/**
 * Answer the CLI's AskUserQuestion dialog in the session's live herdr pane.
 * Keys are only sent while the session's hook-reported question is still the
 * one being answered, and are derived from that stored question, so a stale
 * card can never type into a pane that moved on.
 */
export async function handleHerdrQuestion(
	request: Request,
	dependencies: HerdrQuestionDependencies = defaultHerdrQuestionDependencies,
): Promise<Response> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;

	if (!dependencies.writesEnabled()) {
		return Response.json({error: "herdr writes are disabled"}, {status: 403});
	}

	const parsed = HerdrQuestionSchema.safeParse(await request.json());
	if (!parsed.success) {
		return Response.json({error: "sessionId, toolUseId and one answer per question are required"}, {status: 400});
	}
	const {sessionId, toolUseId, answers} = parsed.data;

	const pending = dependencies.pendingQuestion(sessionId);
	if (pending?.toolUseId !== toolUseId) {
		return Response.json({error: "That question is no longer pending"}, {status: 409});
	}
	const steps = questionAnswerSteps(pending.questions, answers);
	if (steps === null) {
		return Response.json({error: "The answers do not fit the pending question"}, {status: 400});
	}

	const target = await dependencies.resolveTarget(sessionId);
	if (!target.ok) return Response.json({error: target.message}, {status: 502});

	for (const [index, step] of steps.entries()) {
		if (index > 0) await dependencies.pause();
		const response = await dependencies.request({
			id: dependencies.createRequestId(),
			...stepCall(target.value.paneId, step),
		});
		if (!response.ok) {
			return Response.json({error: response.message}, {status: response.code === "agent_not_ready" ? 409 : 502});
		}
	}
	return Response.json({ok: true});
}
