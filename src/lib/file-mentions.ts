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

/** Upstream's popup width: 560px when any row has a dirname caption, else 420px. */
export function fileMentionMenuWidth(entries: readonly {relPath: string}[]): number {
	return entries.some((entry) => entry.relPath.includes("/")) ? 560 : 420;
}

const MENTION_COLLISION_PADDING = 16;
const MENTION_ANCHOR_GAP = 4;
const MENTION_SIDE_OFFSET = 24;

/**
 * Where the "@" popup goes, as CSS `left`/`bottom` within its container. Upstream anchors a zero-size rect at
 * `{@.left, @.bottom + 4}` and opens on top with `sideOffset 24` and `collisionPadding 16`, so the popup's bottom sits
 * 20px above the glyph's bottom, left-aligned to the `@` and kept inside the viewport. All inputs are viewport pixels.
 */
export function fileMentionMenuPosition({
	at,
	container,
	width,
	viewportWidth,
}: {
	at: {left: number; bottom: number};
	container: {left: number; bottom: number};
	width: number;
	viewportWidth: number;
}): {left: number; bottom: number} {
	const shown = Math.min(width, viewportWidth - 2 * MENTION_COLLISION_PADDING);
	const left = Math.max(
		MENTION_COLLISION_PADDING,
		Math.min(at.left, viewportWidth - MENTION_COLLISION_PADDING - shown),
	);
	const popupBottom = at.bottom + MENTION_ANCHOR_GAP - MENTION_SIDE_OFFSET;
	return {left: left - container.left, bottom: container.bottom - popupBottom};
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
