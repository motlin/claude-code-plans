/**
 * Why a blocked session waits on the user, from its pending approval's tool: asking a question
 * unless a non-AskUserQuestion permission prompt is pending.
 */
export function blockedDetail(toolName: string | undefined): string {
	return toolName !== undefined && toolName !== "AskUserQuestion" ? "Needs permission" : "Asked a question";
}
