import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {markFailedSend, readFailedSend} from "../hooks/use-composer-draft";
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
	const [stored, setState] = useState<StoredLiveHerdrPromptState>(EMPTY_LIVE_HERDR_PROMPT_STATE);
	const state = useMemo<LiveHerdrPromptState>(() => ({...stored, isPending: stored.phase !== "idle"}), [stored]);
	const pendingRecordCountRef = useRef<number | null>(null);
	const onRejectedRef = useRef(onRejected);
	onRejectedRef.current = onRejected;

	useEffect(() => {
		pendingRecordCountRef.current = null;
		// Upstream's local draft seed: a draft still equal to its failedSend re-records the rejection with the fallback copy.
		const failedSend = readFailedSend(sessionId);
		setState(
			failedSend === null
				? EMPTY_LIVE_HERDR_PROMPT_STATE
				: {
						phase: "idle",
						prompt: "",
						rejection: {prompt: failedSend, message: SEND_FAILED_MESSAGE, nonResendable: false},
					},
		);
	}, [sessionId]);

	useEffect(() => {
		const pendingRecordCount = pendingRecordCountRef.current;
		if (pendingRecordCount === null) return;
		const prompt = stored.prompt.trim();
		const echoed = lines.some(
			(line) => line.lineIndex >= pendingRecordCount && echoedPromptText(line)?.trim() === prompt,
		);
		if (!echoed) return;
		pendingRecordCountRef.current = null;
		setState(EMPTY_LIVE_HERDR_PROMPT_STATE);
	}, [lines, stored.prompt]);

	const send = useCallback(
		async (prompt: string, options: {midTurn?: true} = {}): Promise<DeliveryResult> => {
			pendingRecordCountRef.current = transcriptRecordCount;
			setState({phase: "sending", prompt, rejection: null});
			try {
				await postPrompt(sessionId, prompt, options);
				setState((current) =>
					current.phase === "sending" && current.prompt === prompt ? {...current, phase: "sent"} : current,
				);
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
					phase: "idle",
					prompt: "",
					rejection: {
						prompt,
						message: error instanceof Error && error.message !== "" ? error.message : SEND_FAILED_MESSAGE,
						nonResendable: false,
					},
				});
				markFailedSend(sessionId, prompt);
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

/** Upstream `MjKIej4fmp`, for a rejection with no error text. */
const SEND_FAILED_MESSAGE = "Send failed";

/** A send the pane refused: the prompt to put back, herdr's message, and whether Try again can resend it. */
export interface SendRejection {
	prompt: string;
	message: string;
	nonResendable: boolean;
}

/**
 * Where the live-pane prompt is: `sending` while the POST is in flight (upstream's
 * `deliveryStatus:"sending"` row), `sent` once herdr typed it and the transcript has yet to echo it.
 */
type LiveHerdrPromptPhase = "idle" | "sending" | "sent";

interface StoredLiveHerdrPromptState {
	phase: LiveHerdrPromptPhase;
	prompt: string;
	rejection: SendRejection | null;
}

interface LiveHerdrPromptState extends StoredLiveHerdrPromptState {
	/** The pane has a prompt of ours on the way: sending or sent. */
	isPending: boolean;
}

const EMPTY_LIVE_HERDR_PROMPT_STATE: StoredLiveHerdrPromptState = {
	phase: "idle",
	prompt: "",
	rejection: null,
};
