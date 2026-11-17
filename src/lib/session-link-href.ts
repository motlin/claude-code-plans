/*
 * Upstream claude.ai/code's session href grammar (c4aef5f87 `D`), plus the local app's own session routes, and
 * the chip a markdown link to one becomes (upstream `oh` → `kn` in c19e90103).
 */
import type {SessionListItem} from "./api/sessions";
import {sidebarStateGroupLabels} from "./schema-choices";
import {sessionRowIconKind, type PullRequestState, type SessionStateKind} from "./session-state";

export type SessionLinkChipState = SessionStateKind | "archived";

export interface SessionLinkHref
{
	/** A claude.ai session id (`session_…`, `ses_…`, `cse_…`) or a local session UUID. */
	id: string;
	/** `session`: a claude.ai session; `local`: one of this app's `/session/<uuid>` routes. */
	kind: "session" | "local";
	/** A bare `#session_…` fragment rather than a URL. */
	isFragment: boolean;
}

const SESSION_ID = String.raw`(?:session|ses|cse)_\w{6,}`;
const SESSION_FRAGMENT = new RegExp(String.raw`^#(${SESSION_ID})$`);
const CLAUDE_SESSION_URL = new RegExp(String.raw`^https?://claude\.ai/code/(?:session/)?(${SESSION_ID})/?(?:[?#].*)?$`);
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LOCAL_ROUTE = new RegExp(
	String.raw`^(?:https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)?/session/(${UUID})/?(?:[?#].*)?$`,
	"i",
);

/**
 * The session `href` links to: upstream's `#session_…` fragments and claude.ai session URLs (`#local_`/`#cmsg_`
 * and anything else are null), or a local `/session/<uuid>` route, written relative, on a localhost origin, or on
 * `appOrigin` (the app's own origin).
 */
export function parseSessionLinkHref(href: string, appOrigin?: string): SessionLinkHref | null
{
	const fragment = SESSION_FRAGMENT.exec(href);
	if (fragment?.[1] !== undefined)
		return {
			id: fragment[1],
			kind: "session",
			isFragment: true,
		};
	const url = CLAUDE_SESSION_URL.exec(href);
	if (url?.[1] !== undefined)
		return {
			id: url[1],
			kind: "session",
			isFragment: false,
		};
	const path = appOrigin !== undefined && href.startsWith(`${appOrigin}/`) ? href.slice(appOrigin.length) : href;
	const local = LOCAL_ROUTE.exec(path);
	if (local?.[1] !== undefined)
		return {
			id: local[1].toLowerCase(),
			kind: "local",
			isFragment: false,
		};
	return null;
}

/** A linked session found in the local index. */
export interface SessionLinkTarget
{
	localId: string;
	title: string;
	state: SessionLinkChipState;
	/** The hover card's status words (sidebar bucket labels); absent shows none. */
	status?: string;
	/** The session's pull request, for the hover card's PR segment. */
	pr?:
	{
		number: number;
		state: PullRequestState;
	};
}

/** What a markdown link to a session renders: `SessionLinkChip`'s props, with the link text as `label`. */
export interface SessionChipModel
{
	/** The local session id, or the claude.ai id when no local session holds it. */
	sessionId: string;
	title?: string;
	state?: SessionLinkChipState;
	isOpen: boolean;
	/** An in-app route to the local session. */
	internalTo?: string;
	/** An external claude.ai link for a session the index doesn't hold. */
	href?: string;
	label: string;
}

/**
 * The chip for a link `href` with text `text`: a session the index holds (`links`, keyed by the parsed id) routes
 * in-app with its title and state; a local route it doesn't hold still routes in-app; an unknown claude.ai session
 * opens claude.ai in a new tab. Null when `href` names no session.
 */
export function sessionChipModel(
	href: string,
	text: string,
	links: ReadonlyMap<string, SessionLinkTarget> | undefined,
	currentSessionId: string | undefined,
): SessionChipModel | null
{
	const parsed = parseSessionLinkHref(href);
	if (parsed === null) return null;
	const target = links?.get(parsed.id);
	const localId = target?.localId ?? (parsed.kind === "local" ? parsed.id : undefined);
	const model: SessionChipModel =
	{
		sessionId: localId ?? parsed.id,
		isOpen: localId !== undefined && localId === currentSessionId,
		label: text,
	};
	if (localId === undefined) model.href = parsed.isFragment ? `https://claude.ai/code/${parsed.id}` : href;
	else model.internalTo = `/session/${localId}`;
	if (target !== undefined)
	{
		model.title = target.title;
		model.state = target.state;
	}
	return model;
}

/** The chip's view of an indexed session row: its state kind (as the sidebar row icon), status word and PR. */
export function sessionLinkTarget(row: SessionListItem): SessionLinkTarget
{
	const target: SessionLinkTarget =
	{
		localId: row.id,
		title: row.title,
		state: row.archived
			? "archived"
			: sessionRowIconKind(
					{
						bucket: row.bucket,
						unseen: row.unseen,
						serverUnseen: row.unseen,
						unseenError: row.unseenError === true,
						prStatus: row.prStatus,
						showPrStatus: false,
					},
				),
		status: row.archived ? "Archived" : sidebarStateGroupLabels[row.bucket],
	};
	if (row.prStatus !== undefined)
		target.pr =
		{
			number: row.prStatus.number,
			state: row.prStatus.state,
		};
	return target;
}
