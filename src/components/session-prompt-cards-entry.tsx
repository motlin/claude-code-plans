import {ApprovalCardSkeleton} from "./approval-card-skeleton";
import {deferredComponent, deferredModule} from "./deferred-component";

// The pending-prompt cards stay off the session's cold load until one first shows or the page goes idle.
export const sessionPromptCards = deferredModule(async () =>
	import("./session-prompt-cards").then(({InlinePlanApproval, SessionPermissionCard, SendRejectedCard}) => (
	{
		InlinePlanApproval,
		SessionPermissionCard,
		SendRejectedCard,
	})),
);

export const loadSessionPromptCards = sessionPromptCards.preload;

/*
 * Upstream's approval host (`EpitaxyApprovalCards`, `loading: Fj`) draws a card skeleton and then the inline
 * ErrorView, so a failed download never hides a pending permission or plan prompt. The rejected-send card has no
 * upstream counterpart in the 11-10 crawl and stays fail-open.
 */
export const DeferredSessionPermissionCard = deferredComponent(
	sessionPromptCards,
	"SessionPermissionCard",
	{
		loading: ApprovalCardSkeleton,
	},
);
export const DeferredInlinePlanApproval = deferredComponent(
	sessionPromptCards,
	"InlinePlanApproval",
	{
		loading: ApprovalCardSkeleton,
	},
);
export const DeferredSendRejectedCard = deferredComponent(sessionPromptCards, "SendRejectedCard");
