import type {ToastOptions} from "../components/toast-context";
import {launchHerdrSession} from "./api/herdr";
import {buildClaudeCopyCommand} from "./claude-launch-command";
import {writeClipboardText} from "./clipboard";

export interface StartClaudeSessionDependencies {
	launch: (launch: {prompt: string}) => Promise<unknown>;
	copy: (text: string) => Promise<boolean>;
	toast: (options: ToastOptions) => void;
}

export type StartClaudeSessionOutcome = "launched" | "copied" | "failed";

/**
 * Start `claude` with `prompt` in a new herdr tab in the home directory, or
 * copy the equivalent command when herdr cannot launch it. Used by actions
 * tied to no project, such as Customize's "Create with Claude".
 */
export async function startClaudeSession(
	prompt: string,
	{
		launch = launchHerdrSession,
		copy = writeClipboardText,
		toast,
	}: Partial<StartClaudeSessionDependencies> & Pick<StartClaudeSessionDependencies, "toast">,
): Promise<StartClaudeSessionOutcome> {
	try {
		await launch({prompt});
		toast({kind: "success", message: "Started a session in a new terminal tab"});
		return "launched";
	} catch {
		// Fall through to the copied command.
	}
	if (await copy(buildClaudeCopyCommand({prompt}))) {
		toast({kind: "success", message: "Copied command — no terminal to launch in"});
		return "copied";
	}
	toast({kind: "error", message: "Couldn’t start a session. Try again."});
	return "failed";
}
