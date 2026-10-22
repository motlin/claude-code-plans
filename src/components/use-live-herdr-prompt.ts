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
) {
	const [state, setState] = useState<LiveHerdrPromptState>(EMPTY_LIVE_HERDR_PROMPT_STATE);
	const pendingRecordCountRef = useRef<number | null>(null);

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
			setState({error: "", isPending: true, prompt});
			try {
				await postPrompt(sessionId, prompt, options);
				return "sent";
			} catch (error) {
				pendingRecordCountRef.current = null;
				if (isAgentNotReady(error)) {
					setState(EMPTY_LIVE_HERDR_PROMPT_STATE);
					return "not-ready";
				}
				setState({
					error: error instanceof Error ? error.message : "Failed to send prompt",
					isPending: false,
					prompt,
				});
				return "failed";
			}
		},
		[postPrompt, sessionId, transcriptRecordCount],
	);

	return {send, state};
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

interface LiveHerdrPromptState {
	error: string;
	isPending: boolean;
	prompt: string;
}

const EMPTY_LIVE_HERDR_PROMPT_STATE: LiveHerdrPromptState = {
	error: "",
	isPending: false,
	prompt: "",
};
