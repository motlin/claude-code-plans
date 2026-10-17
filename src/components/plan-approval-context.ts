import {createContext, useContext} from "react";

import type {PlanDecision, PlanDialog} from "../lib/plan-approval";
import type {QuestionAnswerRoute} from "../lib/question-answer-route";

export interface PlanApprovalContextValue {
	/** Where an answer to the session's pending plan goes; only `live-pane` types it. */
	answerRoute: QuestionAnswerRoute;
	/** Read what the session pane's open plan dialog offers; rejects when it is not showing. */
	loadDialog: () => Promise<PlanDialog>;
	/** Type a choice into the session pane's plan dialog; rejects with the error the card shows. */
	decide: (decision: PlanDecision) => Promise<void>;
}

const PlanApprovalContext = createContext<PlanApprovalContextValue | null>(null);

export const PlanApprovalProvider = PlanApprovalContext.Provider;

/** The session's plan approval route, or null outside a session view (read-only display). */
export function usePlanApprovalContext(): PlanApprovalContextValue | null {
	return useContext(PlanApprovalContext);
}
