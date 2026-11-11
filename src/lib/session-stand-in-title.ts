/** Upstream's last-resort session name (intl `3kbIhS7KZS`), for a session nothing names. */
export const UNTITLED_SESSION_TITLE = "Untitled";

/** A session's displayed name, and whether it only stands in for a title the session does not have. */
export interface SessionDisplayTitle {
	title: string;
	titleIsStandIn?: true;
}

/** The last segment of a directory path, as upstream's `K7(originCwd || cwd)` names a session's place. */
function folderName(cwd: string | null | undefined): string {
	return (cwd ?? "").split(/[\\/]/u).findLast((segment) => segment.trim() !== "") ?? "";
}

/**
 * Upstream's `fK` tail: the index falls back to the session id when nothing titles a session, and that id is shown
 * as the session's folder, else "Untitled", marked as a stand-in so renaming starts from an empty field.
 */
export function sessionDisplayTitle(title: string, id: string, cwd: string | null | undefined): SessionDisplayTitle {
	if (title.trim() !== "" && title !== id) return {title};
	return {title: folderName(cwd) || UNTITLED_SESSION_TITLE, titleIsStandIn: true};
}

/**
 * Whether the session still awaits its first title, upstream's `awaitingFirstTitle && !metaTitle`: locally a live
 * session with no message yet, whose title will come from its first prompt. An ended untitled session keeps the
 * interactive stand-in title, as upstream's does.
 */
export function sessionTitlePending(
	session: {titleIsStandIn?: true | undefined; messageCount: number},
	isActive: boolean,
): boolean {
	return isActive && session.titleIsStandIn === true && session.messageCount === 0;
}
