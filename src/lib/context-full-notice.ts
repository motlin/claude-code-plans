/**
 * Upstream's session-level `api_prompt_too_long` notice copy (shared-60 `a0.contextFull*` rows and
 * the c3e34355f body pick). Wiring is deliberately left out: locally the transcript's API-error card
 * already carries this state, so this table is for a session-error surface without that card.
 */

export interface ContextFullNoticeState
{
	/** Automatic compaction failed for a reason other than exhausted/too_few_groups/aborted/media_unstrippable. */
	compactFailed: boolean;
	/** The notice shows Try again. */
	retryShown: boolean;
	/** The session has a live composer to send a new message from. */
	hasComposer: boolean;
}

export interface ContextFullNotice
{
	title: string;
	body: string;
	/** Upstream's `retryHelps`: only the compact-failed variant gets Try again. */
	retryHelps: boolean;
}

interface Bodies
{
	body: string;
	bodyWithoutRetry: string;
	bodyWithoutComposer: string;
}

const PLAIN: Bodies =
{
	body: "This conversation is too long to continue. You can start a new session, or turn off some connectors to free up space.",
	bodyWithoutRetry:
		"This conversation is too long to continue. You can start a new session, or turn off some connectors to free up space.",
	bodyWithoutComposer: "This conversation is too long to continue. Start a new session.",
};

const COMPACT_FAILED: Bodies =
{
	body: "Couldn’t compact this conversation to free up space. Try again, or start a new session.",
	bodyWithoutRetry:
		"Couldn’t compact this conversation to free up space. Send a message to try again, or start a new session.",
	bodyWithoutComposer: "Couldn’t compact this conversation to free up space. Start a new session.",
};

export function contextFullNotice({compactFailed, retryShown, hasComposer}: ContextFullNoticeState): ContextFullNotice
{
	const bodies = compactFailed ? COMPACT_FAILED : PLAIN;
	return {
		title: "Your context window is full",
		body: retryShown ? bodies.body : hasComposer ? bodies.bodyWithoutRetry : bodies.bodyWithoutComposer,
		retryHelps: compactFailed,
	};
}
