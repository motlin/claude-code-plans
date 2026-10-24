import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {markFailedSend, readFailedSend} from "../hooks/use-composer-draft";
import {type DeliveryResult} from "../hooks/use-composer-queue";
import {HerdrRequestError, isAgentNotReady, sendHerdrPrompt} from "../lib/api/herdr";
import {requestComposerTakeBack} from "../lib/context-attach";
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
	/** Whether the session has a live pane now; a held prompt is delivered when this turns true. */
	hasLivePane = true,
	/** Changes whenever the session's herdr pane list or revision does; a held prompt is re-sent on each change. */
	livePaneKey = "",
) {
	const [stored, setState] = useState<StoredLiveHerdrPromptState>(EMPTY_LIVE_HERDR_PROMPT_STATE);
	const state = useMemo<LiveHerdrPromptState>(() => ({...stored, isPending: stored.phase !== "idle"}), [stored]);
	/** Backoff retries since the prompt was first held; the next retry waits twice as long as the last. */
	const [heldRetries, setHeldRetries] = useState(0);
	const pendingRecordCountRef = useRef<number | null>(null);
	const onRejectedRef = useRef(onRejected);
	onRejectedRef.current = onRejected;

	useEffect(() => {
		pendingRecordCountRef.current = null;
		setHeldRetries(0);
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
				setHeldRetries(0);
				setState((current) =>
					current.phase === "sending" && current.prompt === prompt ? {...current, phase: "sent"} : current,
				);
				return "sent";
			} catch (error) {
				pendingRecordCountRef.current = null;
				if (!isNoLivePane(error)) setHeldRetries(0);
				if (isAgentNotReady(error)) {
					setState(EMPTY_LIVE_HERDR_PROMPT_STATE);
					return "not-ready";
				}
				// Upstream `heldForHost`: with no pane to type into, the row waits for one instead of failing.
				if (isNoLivePane(error)) {
					setState({phase: "held", prompt, rejection: null});
					return "failed";
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

	const sendRef = useRef(send);
	sendRef.current = send;
	const hadLivePaneRef = useRef(hasLivePane);
	const lastLivePaneKeyRef = useRef(livePaneKey);
	useEffect(() => {
		const gained = hasLivePane && !hadLivePaneRef.current;
		const paneChanged = livePaneKey !== lastLivePaneKeyRef.current;
		hadLivePaneRef.current = hasLivePane;
		lastLivePaneKeyRef.current = livePaneKey;
		if (hasLivePane && (gained || paneChanged) && stored.phase === "held") void sendRef.current(stored.prompt);
	}, [hasLivePane, livePaneKey, stored.phase, stored.prompt]);

	// herdr can say pane-not-found while the pane table still lists one, so a held prompt also retries on a backoff.
	useEffect(() => {
		if (stored.phase !== "held" || !hasLivePane) return undefined;
		const delay = Math.min(HELD_RETRY_BASE_MS * 2 ** heldRetries, HELD_RETRY_MAX_MS);
		const prompt = stored.prompt;
		const timer = setTimeout(() => {
			setHeldRetries((count) => count + 1);
			void sendRef.current(prompt);
		}, delay);
		return () => {
			clearTimeout(timer);
		};
	}, [hasLivePane, heldRetries, stored.phase, stored.prompt]);

	/** Upstream `onRecallHeld`: the held row goes and its text returns to the composer above the draft. */
	const withdraw = useCallback(() => {
		if (stored.phase !== "held") return;
		requestComposerTakeBack(sessionId, stored.prompt);
		setHeldRetries(0);
		setState(EMPTY_LIVE_HERDR_PROMPT_STATE);
	}, [sessionId, stored.phase, stored.prompt]);

	const clearRejection = useCallback(() => {
		setState((current) => (current.rejection === null ? current : {...current, rejection: null}));
	}, []);

	return {send, clearRejection, withdraw, state};
}

/** herdr's answer for a session with no live pane to type into: hold the prompt until one appears. */
function isNoLivePane(error: unknown): boolean {
	return (
		error instanceof HerdrRequestError && (error.code === "session-not-found" || error.code === "pane-not-found")
	);
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

/** First retry of a held prompt whose pane looks live; each further retry doubles, up to the cap. */
const HELD_RETRY_BASE_MS = 2000;
const HELD_RETRY_MAX_MS = 30_000;

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
 * `deliveryStatus:"sending"` row), `sent` once herdr typed it and the transcript has yet to echo it,
 * `held` while the session has no live pane to take it (upstream's `heldForHost` row).
 */
type LiveHerdrPromptPhase = "idle" | "sending" | "sent" | "held";

interface StoredLiveHerdrPromptState {
	phase: LiveHerdrPromptPhase;
	prompt: string;
	rejection: SendRejection | null;
}

interface LiveHerdrPromptState extends StoredLiveHerdrPromptState {
	/** The pane has a prompt of ours on the way: sending, sent, or held for a pane. */
	isPending: boolean;
}

const EMPTY_LIVE_HERDR_PROMPT_STATE: StoredLiveHerdrPromptState = {
	phase: "idle",
	prompt: "",
	rejection: null,
};
