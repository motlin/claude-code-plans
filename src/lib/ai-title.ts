/**
 * The CLI's generated ai-title to show beside a session's displayed title, or null when there is
 * none or it is the displayed title. A /rename title wins the title slot, but claude.ai/code never
 * sees /rename and shows the AI title, so it stays visible as a secondary line.
 */
export function secondaryAiTitle(title: string, aiTitle: string | null | undefined): string | null {
	const trimmed = aiTitle?.trim() ?? "";
	if (trimmed === "" || trimmed === title.trim()) return null;
	return trimmed;
}
