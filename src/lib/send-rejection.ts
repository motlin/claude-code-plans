export type RejectedRetryAction = "resend" | "focus";

export interface SendRejectedCopy {
	title: string;
	body: string;
	retry: boolean;
}

/** Upstream `d`: Try again resends only while the composer still holds the rejected prompt. */
export function rejectedRetryAction(rejectedPrompt: string | null, composerText: string): RejectedRetryAction {
	return rejectedPrompt !== null && composerText === rejectedPrompt ? "resend" : "focus";
}

/** Upstream `qn` generic copy for `local_send_rejected`, with the nonResendable body swap. */
export function sendRejectedCopy({nonResendable}: {nonResendable: boolean}): SendRejectedCopy {
	if (nonResendable) {
		return {
			title: "Something went wrong",
			body: "Your message didn’t send. Check the error details before sending it again.",
			retry: false,
		};
	}
	return {
		title: "Something went wrong",
		body: "Try sending your message again. If it keeps failing, the error details show why.",
		retry: true,
	};
}

/** Local stand-in for upstream `mn`: keep text typed while the send was in flight below the restored prompt. */
export function mergeRefill(rejected: string, current: string): string {
	return current.trim() === "" ? rejected : `${rejected}\n\n${current}`;
}

/** A failed home launch: the herdr reason and the prompt put back in the composer (upstream `restoredDraft`). */
export interface StartFailure {
	message: string;
	restoredDraft: string;
}

/** Upstream `Tr`'s toast when a new session fails to start after the user left the New session page. */
export function startFailedOffscreenToast({promptIsBack}: {promptIsBack: boolean}): string {
	return promptIsBack
		? "Your new session couldn’t start. Your prompt is back on the New session page."
		: "Your new session couldn’t start.";
}
