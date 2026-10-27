import {useCallback} from "react";

import {focusComposer, getComposerText, submitComposer} from "../lib/context-attach";
import {rejectedRetryAction} from "../lib/send-rejection";
import type {SendRejection} from "./use-live-herdr-prompt";

/**
 * The send-rejected card's buttons. Upstream `dS`: Try again clears the error
 * first on every path, then resends only while the composer still holds the
 * rejected prompt, and otherwise focuses it. Dismiss (`Kx`) clears and focuses.
 * Neither changes the composer text.
 */
export function useSendRejectionActions(
	sessionId: string,
	rejection: SendRejection | null,
	clearRejection: () => void,
) {
	const retryRejection = useCallback(() => {
		clearRejection();
		const rejectedPrompt = rejection === null || rejection.nonResendable ? null : rejection.prompt;
		const action = rejectedRetryAction(rejectedPrompt, getComposerText(sessionId) ?? "");
		if (action === "resend" && submitComposer(sessionId)) return;
		focusComposer(sessionId);
	}, [clearRejection, rejection, sessionId]);

	const dismissRejection = useCallback(() => {
		clearRejection();
		focusComposer(sessionId);
	}, [clearRejection, sessionId]);

	return {retryRejection, dismissRejection};
}
