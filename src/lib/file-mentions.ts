/** Composer "@" file mentions: trigger detection and insertion, shared by the popup and its hook. */

export const FILE_MENTION_CAP = 15;
export const FILE_MENTION_DEBOUNCE_MS = 150;

/** VCS and OS junk basenames upstream drops from mention suggestions. */
export const HIDDEN_MENTION_NAMES: ReadonlySet<string> = new Set([
	".git",
	".svn",
	".hg",
	"CVS",
	".DS_Store",
	"__MACOSX",
	"Thumbs.db",
	"desktop.ini",
]);

export interface FileMentionTrigger {
	/** Index of the `@`. */
	start: number;
	/** The token typed after the `@`, up to the caret. */
	query: string;
}

/**
 * The open mention before `caret`: an `@` at the start of the text or after
 * whitespace (so never inside an email address), followed by no whitespace.
 */
export function fileMentionTrigger(text: string, caret: number): FileMentionTrigger | null {
	const match = /(?:^|\s)@(\S*)$/.exec(text.slice(0, caret));
	if (match === null) return null;
	const query = match[1] ?? "";
	return {start: caret - query.length - 1, query};
}

/**
 * Whether an Escape-dismissed mention still suppresses `token` (`@` plus query):
 * upstream keeps the menu closed while the token extends the dismissed one, but a
 * dismissed bare `@` only suppresses an exact `@`.
 */
export function isMentionSuppressed(suppressed: string | null, token: string): boolean {
	if (suppressed === null) return false;
	return suppressed === "@" ? token === "@" : token.startsWith(suppressed);
}

/** `@path`, quoted when the path holds whitespace (the CLI reads `@"a b.ts"`). */
function mentionToken(relPath: string): string {
	return /\s/.test(relPath) ? `@"${relPath}"` : `@${relPath}`;
}

/** Replaces the mention token with `@<relative path> ` and returns the caret after it. */
export function insertFileMention(
	text: string,
	trigger: FileMentionTrigger,
	caret: number,
	relPath: string,
): {text: string; caret: number} {
	const inserted = `${mentionToken(relPath)} `;
	return {
		text: text.slice(0, trigger.start) + inserted + text.slice(caret),
		caret: trigger.start + inserted.length,
	};
}
