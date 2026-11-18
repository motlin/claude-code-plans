import {useCallback} from "react";

import type {DeliveryResult} from "../hooks/use-composer-queue";
import {focusComposer, getComposerText, submitComposer} from "../lib/context-attach";
import {rejectedRetryAction} from "../lib/send-rejection";
import type {SendRejection} from "./use-live-herdr-prompt";

/** The live prompt's durable Not delivered rows (upstream `retryFailedSend` / `discardFailedSend`). */
export interface FailedSendHandlers
{
	retryFailedSend: (id: string) => Promise<DeliveryResult | null>;
	discardFailedSend: (id: string) => void;
}

/**
 * The send-rejected card's buttons and the durable Not delivered row's. Upstream `dS`: Try again clears the
 * error first on every path, then resends only while the composer still holds the rejected prompt, and
 * otherwise focuses it. Dismiss (`Kx`) clears and focuses. Neither changes the composer text. The row's
 * Retry and Discard clear the card too, so a session never shows two competing retries.
 */
export function useSendRejectionActions(
	sessionId: string,
	rejection: SendRejection | null,
	clearRejection: () => void,
	failed?: FailedSendHandlers,
)
{
	const retryRejection = useCallback(() =>
	{
		clearRejection();
		const rejectedPrompt = rejection === null || rejection.nonResendable ? null : rejection.prompt;
		const action = rejectedRetryAction(rejectedPrompt, getComposerText(sessionId) ?? "");
		if (action === "resend" && submitComposer(sessionId)) return;
		focusComposer(sessionId);
	}, [clearRejection, rejection, sessionId]);

	const dismissRejection = useCallback(() =>
	{
		clearRejection();
		focusComposer(sessionId);
	}, [clearRejection, sessionId]);

	const retryFailed = failed?.retryFailedSend;
	const retryFailedSend = useCallback(
		(id: string) =>
		{
			clearRejection();
			void retryFailed?.(id);
		},
		[clearRejection, retryFailed],
	);

	const discardFailed = failed?.discardFailedSend;
	const discardFailedSend = useCallback(
		(id: string) =>
		{
			clearRejection();
			discardFailed?.(id);
		},
		[clearRejection, discardFailed],
	);

	return {
		retryRejection,
		dismissRejection,
		retryFailedSend,
		discardFailedSend,
	};
}
