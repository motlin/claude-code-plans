import type {SessionBucket} from "./session-state";

/** A row's status on its described line, upstream's `E`. */
export type MetaStatus = "idle" | "unread" | "working" | "blocked" | "error";

/** Where a session runs (its folder); `spoken` leaves it in the row's accessible text. */
export interface MetaPlace {
	text: string;
	spoken: boolean;
}

/** The second line of a "described" sidebar row (Show ▸ Metadata), upstream's `L2` result. */
export interface SessionMetaLine {
	word?: MetaStatus;
	text?: string;
	place?: MetaPlace;
}

export interface SessionMetaLineInput {
	status: MetaStatus;
	/** The row sits under a state-grouped heading, which already names its status. */
	underStatusHeading: boolean;
	/** Why a blocked row waits on the user. */
	reason?: string | undefined;
	message?: string | undefined;
	place: MetaPlace;
	heading: string;
}

/** Upstream `Ia`: the group heading already names the place, so the line needn't repeat it. */
function headingNamesPlace(heading: string, place: string): boolean {
	return heading === place || heading.startsWith(`${place} · `);
}

/** Upstream `L2`: the status word, the message (or blocked reason), and the place. */
export function sessionMetaLine({
	status,
	underStatusHeading,
	reason,
	message,
	place,
	heading,
}: SessionMetaLineInput): SessionMetaLine {
	const candidate = underStatusHeading ? undefined : status;
	const blocked = status === "blocked" && (candidate !== undefined || reason !== undefined);
	const text = blocked ? (reason ?? message) : message;
	const word = blocked || text === undefined ? candidate : undefined;
	const dropPlace = headingNamesPlace(heading, place.text) && (word !== undefined || text !== undefined);
	return {
		...(word === undefined ? {} : {word}),
		...(text === undefined ? {} : {text}),
		...(dropPlace ? {} : {place}),
	};
}

const BUCKET_STATUS = {
	blocked: "blocked",
	working: "working",
	review: "unread",
	done: "idle",
} satisfies Record<SessionBucket, MetaStatus>;

/** A row's upstream status from its bucket: archived rows are idle, an unseen errored turn is an error. */
export function metaStatus(session: {
	bucket: SessionBucket;
	archived: boolean;
	unseenError?: true | undefined;
}): MetaStatus {
	if (session.archived) return "idle";
	if (session.unseenError === true) return "error";
	return BUCKET_STATUS[session.bucket];
}

/**
 * Upstream `jv`: what the session did, for the line's text. Local has no per-turn task summary, so a working or
 * blocked row shows the last user message, and a settled row its summary first.
 */
export function sessionMetaMessage(
	session: {summary?: string | undefined; lastUserMessage?: string | undefined},
	status: MetaStatus,
): string | undefined {
	const settled = status === "idle" || status === "unread" || status === "error";
	return (settled ? session.summary : undefined) ?? session.lastUserMessage;
}
