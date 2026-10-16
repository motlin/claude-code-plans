import {useQuery} from "@tanstack/react-query";

import {useQuestionAnswerRoute} from "../hooks/use-question-answer-route";
import {assertNever} from "../lib/assert-never";
import {approvalsQueryOptions} from "../lib/api/approvals";
import {notificationsQueryOptions} from "../lib/api/notifications";
import {pendingQuestionQueryOptions} from "../lib/api/pending-question";
import {isQuickReplyQuestion, resolveAwaitingGate, type AwaitingGate} from "../lib/awaiting-gate";
import {PERMISSION_PROMPT_NOTIFICATION} from "../lib/permission-prompt";
import type {QuestionAnswerRoute} from "../lib/question-answer-route";

export interface AwaitingGateState {
	/** Null until the session's pending question has loaded. */
	gate: AwaitingGate | null;
	/**
	 * Where an answer goes: the live herdr pane (writes on), a fork of a stopped
	 * session, or nowhere, as for every question card.
	 */
	route: QuestionAnswerRoute;
	/** The card takes the pointer: it can answer in place. */
	interactive: boolean;
}

/** Whether the card can answer: typing into the live pane needs the hook's question; a fork answers by label. */
export function questionAnswerable(
	gate: Extract<AwaitingGate, {kind: "question"}>,
	route: QuestionAnswerRoute,
): boolean {
	if (!isQuickReplyQuestion(gate.questions)) return false;
	return route === "fork" || (route === "live-pane" && gate.answerable);
}

function isInteractive(gate: AwaitingGate | null, route: QuestionAnswerRoute): boolean {
	if (gate === null) return false;
	switch (gate.kind) {
		case "question":
			return questionAnswerable(gate, route);
		case "plan":
			return false;
		case "permission":
		case "none":
			return route === "live-pane";
		default:
			return assertNever(gate);
	}
}

/** What a Needs input row's open hover card answers, and where its answer goes. */
export function useAwaitingGate(sessionId: string): AwaitingGateState {
	const pending = useQuery(pendingQuestionQueryOptions(sessionId));
	const approval = useQuery({
		...approvalsQueryOptions(),
		select: (data) => data.approvals.find((entry) => entry.sessionId === sessionId),
	}).data;
	const permission =
		useQuery({
			...notificationsQueryOptions(),
			select: (data) =>
				data.notifications.find(
					(entry) =>
						entry.sessionId === sessionId && entry.notificationType === PERMISSION_PROMPT_NOTIFICATION,
				)?.message ?? null,
		}).data ?? null;
	const route = useQuestionAnswerRoute(sessionId);
	const gate =
		pending.data === undefined
			? null
			: resolveAwaitingGate({pendingQuestion: pending.data.pendingQuestion, approval, permission});
	return {gate, route, interactive: isInteractive(gate, route)};
}
