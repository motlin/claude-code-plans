import {parseBtwCommand} from "../lib/side-chat";
import {askSideChat, openSideChat} from "../lib/side-chat-store";
import type {ToastOptions} from "./toast-context";

/**
 * The composer's `/btw` interception, run before a prompt is sent. Returns
 * true when the prompt was a `/btw` command and must not reach the session.
 */
export function handleBtwPrompt(
	prompt: string,
	{sessionId, messageCount, toast}: {sessionId: string; messageCount: number; toast: (options: ToastOptions) => void},
): boolean {
	const command = parseBtwCommand(prompt);
	if (command === null) return false;
	if (messageCount === 0) {
		toast({kind: "error", message: NOT_STARTED_MESSAGE});
		return true;
	}
	openSideChat(sessionId);
	if (command.question !== "") void askSideChat(sessionId, command.question);
	return true;
}

const NOT_STARTED_MESSAGE = "Side chat is available once this session starts. Send your first message to start it.";
