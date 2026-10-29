import type {PlanDecision, PlanDialog} from "../lib/plan-approval";
import type {QuestionAnswerRoute} from "../lib/question-answer-route";

export interface PlanApprovalContextValue {
	/** The session whose Plan pane comments the card lists and sends with Revise. */
	sessionId: string;
	/** Where an answer to the session's pending plan goes; only `live-pane` types it. */
	answerRoute: QuestionAnswerRoute;
	/** Read what the session pane's open plan dialog offers; rejects when it is not showing. */
	loadDialog: () => Promise<PlanDialog>;
	/** Type a choice into the session pane's plan dialog; rejects with the error the card shows. */
	decide: (decision: PlanDecision) => Promise<void>;
}
