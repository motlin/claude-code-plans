import type {ToastOptions} from "../components/toast-context";
import {sendHerdrPrompt} from "./api/herdr";

/** Upstream's `uf`: a `!` and whitespace before the command is how a typed shell command looks outside bash mode. */
const SHELL_COMMAND_TEXT = /^!\s+\S/;

/** Upstream `zR`: text that would run as a shell command, sent from a composer that can't run one. */
export function isShellCommandText(text: string): boolean {
	return SHELL_COMMAND_TEXT.test(text);
}

/** Upstream's refusal: QrY1V2 for a session without a live pane, AYbIPZ before any session exists. */
export function shellCommandUnavailableMessage(variant: "session" | "home"): string {
	return variant === "home"
		? "Start a local session first to run shell commands."
		: "Shell commands are only available in local sessions.";
}

interface RunShellCommandDependencies {
	post?: (sessionId: string, prompt: string) => Promise<void>;
	toast: (options: ToastOptions) => void;
}

/**
 * Types `!<command>` into the session's live pane through the guarded prompt write path, so the CLI runs it in its
 * own bash mode. Resolves false (after a toast) when the write was refused, so the composer can hand it back.
 */
export async function runShellCommandInPane(
	sessionId: string,
	command: string,
	{post = async (id, prompt) => sendHerdrPrompt(id, prompt), toast}: RunShellCommandDependencies,
): Promise<boolean> {
	try {
		await post(sessionId, `!${command}`);
		return true;
	} catch (error) {
		toast({
			kind: "error",
			message: "Couldn’t run the shell command",
			description: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}
