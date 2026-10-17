import {assertNever} from "./assert-never";
import type {PendingQuestion, PendingQuestionItem, QuestionAnswer} from "./hook-events";

/** Upstream's session composer placeholder, whatever the session waits on. */
export const SESSION_COMPOSER_PLACEHOLDER = "Type / for commands";

/**
 * Upstream's answer to every question of an AskUserQuestion the user skipped by
 * sending a composer message instead.
 */
export const QUESTION_DISMISSED_BY_MESSAGE =
	"[User did not answer this question — they sent a message instead. Treat that message as their response; do not re-ask.]";

/** What the session's CLI shows a dialog for, as the composer sees it. */
export type ComposerPendingGate =
	| {kind: "question"; toolUseId: string; questions: PendingQuestionItem[]}
	/** A question the transcript shows but no hook reported, so the pane cannot be answered. */
	| {kind: "held-question"}
	| {kind: "permission"}
	| {kind: "none"};

export function composerPendingGate({
	hookQuestion,
	transcriptQuestion,
	awaitingPermission,
}: {
	/** The hook-reported pending question; undefined while it has not loaded. */
	hookQuestion: PendingQuestion | null | undefined;
	transcriptQuestion: boolean;
	awaitingPermission: boolean;
}): ComposerPendingGate {
	if (hookQuestion !== null && hookQuestion !== undefined) {
		return {kind: "question", toolUseId: hookQuestion.toolUseId, questions: hookQuestion.questions};
	}
	if (transcriptQuestion) return {kind: "held-question"};
	if (awaitingPermission) return {kind: "permission"};
	return {kind: "none"};
}

export type ComposerSend =
	| {kind: "send"}
	| {kind: "queue"}
	| {kind: "dismiss-question-then-queue"; toolUseId: string; answers: QuestionAnswer[]};

export interface ComposerSendPlan {
	disabled: false;
	placeholder: string;
	send: ComposerSend;
}

/** Queued prompts wait while a dialog is up, as upstream blocks parked auto-send under a question. */
export function gateHoldsQueue(gate: ComposerPendingGate): boolean {
	return gate.kind !== "none";
}

/**
 * Upstream keeps the composer enabled with its usual placeholder while a
 * question or permission waits. Sending under a question dismisses it with
 * {@link QUESTION_DISMISSED_BY_MESSAGE} and then sends the message; under a
 * permission the message waits for the turn. A pane showing a dialog is never
 * typed into, so the skip's message queues mid-turn, typed in as soon as the
 * hooks show the dialog closed, and any other message queues until idle.
 */
export function composerSendPlan(
	gate: ComposerPendingGate,
	{busy, queued}: {busy: boolean; queued: number},
): ComposerSendPlan {
	const plan = {disabled: false, placeholder: SESSION_COMPOSER_PLACEHOLDER} as const;
	switch (gate.kind) {
		case "question":
			return {
				...plan,
				send: {
					kind: "dismiss-question-then-queue",
					toolUseId: gate.toolUseId,
					answers: gate.questions.map(() => ({selected: [], other: QUESTION_DISMISSED_BY_MESSAGE})),
				},
			};
		case "held-question":
		case "permission":
			return {...plan, send: {kind: "queue"}};
		case "none":
			return {...plan, send: busy || queued > 0 ? {kind: "queue"} : {kind: "send"}};
		default:
			return assertNever(gate);
	}
}
