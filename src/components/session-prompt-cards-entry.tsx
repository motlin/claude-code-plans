import {deferredComponent, deferredModule} from "./deferred-component";

// The pending-prompt cards stay off the session's cold load until one first shows or the page goes idle.
const promptCards = deferredModule(async () =>
	import("./session-prompt-cards").then(({InlinePlanApproval, PermissionCard, SendRejectedCard}) => ({
		InlinePlanApproval,
		PermissionCard,
		SendRejectedCard,
	})),
);

export const loadSessionPromptCards = promptCards.preload;
export const DeferredPermissionCard = deferredComponent(promptCards, "PermissionCard");
export const DeferredInlinePlanApproval = deferredComponent(promptCards, "InlinePlanApproval");
export const DeferredSendRejectedCard = deferredComponent(promptCards, "SendRejectedCard");
