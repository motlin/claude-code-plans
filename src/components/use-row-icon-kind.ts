import type {SessionListItem} from "../lib/api/sessions";
import {sessionRowIconKind, type SessionStateKind} from "../lib/session-state";
import {useSettings} from "./settings-context";
import {useHasUnseenWork} from "./use-has-unseen-work";

/**
 * A sidebar row's trailing-slot kind, from its bucket, unseen work and the Show PR status pref.
 * The open pane's own row is never unread (upstream `serverUnread = isUnread && !paneSelected`).
 */
export function useRowIconKind(session: SessionListItem, paneSelected: boolean)
{
	const unseen = useHasUnseenWork(session.id) && !paneSelected;
	const {settings} = useSettings();
	return {
		unseen,
		showPrStatus: settings.sessionListPrefs.showPrStatus,
		kind: sessionRowIconKind(
			{
				bucket: session.bucket,
				unseen,
				serverUnseen: session.unseen,
				unseenError: session.unseenError === true,
				prStatus: session.prStatus,
				showPrStatus: settings.sessionListPrefs.showPrStatus,
			},
		),
	};
}

/**
 * Upstream `vW`'s attention look for a row title: none on an archived row (upstream maps it to
 * idle), waiting for awaiting, unread for ready. A running row has none: upstream's row passes
 * `workingSays=false`, so its working case returns null.
 */
export function rowAttention({kind, archived}: {kind: SessionStateKind; archived: boolean}): RowAttention | undefined
{
	if (archived) return undefined;
	if (kind === "awaiting") return "waiting";
	if (kind === "ready") return "unread";
	return undefined;
}

export type RowAttention = "waiting" | "unread";

/** The row title's upstream `data-attention` value, or undefined when the row has no attention look. */
export function useRowAttention(session: SessionListItem, paneSelected: boolean): RowAttention | undefined
{
	const {kind} = useRowIconKind(session, paneSelected);
	return rowAttention(
		{
			kind,
			archived: session.archived,
		},
	);
}
