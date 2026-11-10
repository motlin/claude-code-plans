import {maskSecrets} from "./secret-mask";

/** Upstream `Jw`'s scan window: only the last 8992 characters are masked and considered. */
export const STICKY_PROMPT_SCAN_CHARS = 8992;
/** Upstream `Gw`: the bubble shows at most the last 800 characters of a prompt. */
export const STICKY_PROMPT_MAX_CHARS = 800;

/**
 * Upstream cf74bc599 `qw` + `Jw`: the text the sticky prompt bubble shows for a
 * prompt, or null when it has none. A long prompt keeps its tail, so the bubble's
 * one-line peek shows the prompt's last line.
 */
export function stickyPromptText(text: string): string | null {
	const trimmed = text.trim();
	if (trimmed === "") return null;
	const scanned = trimmed.length > STICKY_PROMPT_SCAN_CHARS ? trimmed.slice(-STICKY_PROMPT_SCAN_CHARS) : trimmed;
	const masked = maskSecrets(scanned);
	return masked.length > STICKY_PROMPT_MAX_CHARS ? masked.slice(-STICKY_PROMPT_MAX_CHARS) : masked;
}
