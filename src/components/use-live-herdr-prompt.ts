import {useCallback, useEffect, useRef, useState} from "react";
import {type DeliveryResult} from "../hooks/use-composer-queue";
import {isAgentNotReady, sendHerdrPrompt} from "../lib/api/herdr";
import {type SessionLine} from "../lib/transcript";

/**
 * Keeps the optimistic bubble for a prompt sent to the live pane until the
 * transcript echoes that prompt back (waiting in the queue, absorbed mid-turn,
 * or sent as a user record), so unrelated records landing first don't blink it out.
 */
export function useLiveHerdrPrompt(
	sessionId: string,
	transcriptRecordCount: number,
	lines: readonly SessionLine[],
	postPrompt: (sessionId: string, prompt: string, options: {midTurn?: true}) => Promise<void> = sendHerdrPrompt,
	/** Hands a rejected prompt back, as upstream's composer catch refills the composer. */
	onRejected?: (prompt: string) => void,
) {
	const [state, setState] = useState<LiveHerdrPromptState>(EMPTY_LIVE_HERDR_PROMPT_STATE);
	const pendingRecordCountRef = useRef<number | null>(null);
	const onRejectedRef = useRef(onRejected);
	onRejectedRef.current = onRejected;

	useEffect(() => {
		pendingRecordCountRef.current = null;
		setState(EMPTY_LIVE_HERDR_PROMPT_STATE);
	}, [sessionId]);

	useEffect(() => {
		const pendingRecordCount = pendingRecordCountRef.current;
		if (pendingRecordCount === null) return;
		const prompt = state.prompt.trim();
		const echoed = lines.some(
			(line) => line.lineIndex >= pendingRecordCount && echoedPromptText(line)?.trim() === prompt,
		);
		if (!echoed) return;
		pendingRecordCountRef.current = null;
		setState(EMPTY_LIVE_HERDR_PROMPT_STATE);
	}, [lines, state.prompt]);

	const send = useCallback(
		async (prompt: string, options: {midTurn?: true} = {}): Promise<DeliveryResult> => {
			pendingRecordCountRef.current = transcriptRecordCount;
			setState({isPending: true, prompt, rejection: null});
			try {
				await postPrompt(sessionId, prompt, options);
				return "sent";
			} catch (error) {
				pendingRecordCountRef.current = null;
				if (isAgentNotReady(error)) {
					setState(EMPTY_LIVE_HERDR_PROMPT_STATE);
					return "not-ready";
				}
				// Upstream `local_send_rejected`: the bubble goes, the card and the refilled composer take over.
				// Attachments are composed into the text locally, so every rejected prompt can be resent.
				setState({
					isPending: false,
					prompt: "",
					rejection: {
						prompt,
						message: error instanceof Error && error.message !== "" ? error.message : "Send failed",
						nonResendable: false,
					},
				});
				onRejectedRef.current?.(prompt);
				return "failed";
			}
		},
		[postPrompt, sessionId, transcriptRecordCount],
	);

	const clearRejection = useCallback(() => {
		setState((current) => (current.rejection === null ? current : {...current, rejection: null}));
	}, []);

	return {send, clearRejection, state};
}

/** The prompt text a line hands back to the person, or null for a line that echoes no prompt. */
function echoedPromptText(line: SessionLine): string | null {
	switch (line.type) {
		case "queued-prompt":
			return line.content;
		case "user":
			return line.message?.content === undefined ? null : promptText(line.message.content);
		case "attachment":
			return line.humanPrompt === undefined ? null : promptText(line.humanPrompt.content);
		default:
			return null;
	}
}

function promptText(content: string | readonly {type: string; text?: unknown}[]): string {
	if (typeof content === "string") return content;
	return content
		.flatMap((block) => (block.type === "text" && typeof block.text === "string" ? [block.text] : []))
		.join("\n");
}

/** A send the pane refused: the prompt to put back, herdr's message, and whether Try again can resend it. */
export interface SendRejection {
	prompt: string;
	message: string;
	nonResendable: boolean;
}

interface LiveHerdrPromptState {
	isPending: boolean;
	prompt: string;
	rejection: SendRejection | null;
}

const EMPTY_LIVE_HERDR_PROMPT_STATE: LiveHerdrPromptState = {
	isPending: false,
	prompt: "",
	rejection: null,
};
