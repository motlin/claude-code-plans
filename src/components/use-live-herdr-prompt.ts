import {useCallback, useEffect, useRef, useState} from "react";
import {type DeliveryResult} from "../hooks/use-composer-queue";
import {isAgentNotReady, sendHerdrPrompt} from "../lib/api/herdr";

export function useLiveHerdrPrompt(
	sessionId: string,
	transcriptRecordCount: number,
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
		if (pendingRecordCount === null || transcriptRecordCount <= pendingRecordCount) return;
		pendingRecordCountRef.current = null;
		setState(EMPTY_LIVE_HERDR_PROMPT_STATE);
	}, [transcriptRecordCount]);

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
