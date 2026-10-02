import type {QueryClient} from "@tanstack/react-query";
import type {ToastOptions} from "../components/toast";
import {getCachedCanonicalSessionRouteId} from "./api/session-identity";
import {buildClaudeCopyCommand} from "./claude-launch-command";
import {writeClipboardText} from "./clipboard";

type Toast = (options: ToastOptions) => void;

/** The local stand-in for upstream's `claude --teleport <id>`: resume from the session's directory. */
export function sessionResumeCommand(sessionId: string, cwd: string): string {
	return buildClaudeCopyCommand({cwd, args: ["-r", sessionId]});
}

export function vscodeFolderUrl(cwd: string): string {
	return `vscode://file${cwd.split("/").map(encodeURIComponent).join("/")}`;
}

export function claudeAiSessionUrl(bridgeSessionId: string): string {
	const sessionId = bridgeSessionId.replace(/^cse_/, "session_");
	return `https://claude.ai/code/${encodeURIComponent(sessionId)}`;
}

/** Open PR (menu `g`, ⌥⌘G): the `pr-link` URL in a new tab. */
export function openPullRequest(prUrl: string): void {
	window.open(prUrl, "_blank", "noopener,noreferrer");
}

export function sessionUrl(sessionId: string): string {
	return `${window.location.origin}/session/${encodeURIComponent(sessionId)}`;
}

export async function copySessionLink(sessionId: string, toast: Toast, queryClient: QueryClient): Promise<void> {
	const routeId = getCachedCanonicalSessionRouteId(queryClient, sessionId);
	const copied = await writeClipboardText(sessionUrl(routeId));
	toast(
		copied
			? {kind: "success", message: "Link copied to clipboard."}
			: {kind: "error", message: "Couldn’t copy the link. Try again."},
	);
}

export async function copySessionResumeCommand(sessionId: string, cwd: string, toast: Toast): Promise<void> {
	const copied = await writeClipboardText(sessionResumeCommand(sessionId, cwd));
	toast(
		copied
			? {
					kind: "success",
					message: "Command copied. Paste it in a terminal to open this session.",
				}
			: {kind: "error", message: "Couldn’t copy the command. Try again."},
	);
}
