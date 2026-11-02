import type {SessionListItem} from "../lib/api/sessions";
import {sessionRowIconKind, type SessionStateKind} from "../lib/session-state";
import {useSettings} from "./settings-context";
import {useHasUnseenWork} from "./use-has-unseen-work";

/** A sidebar row's trailing-slot kind, from its bucket, unseen work and the Show PR status pref. */
export function useRowIconKind(session: SessionListItem)
{
	const unseen = useHasUnseenWork(session.id);
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

/** Upstream `Sg`'s attention look for a row's status mark: waiting for awaiting, unread for ready. */
export function rowAttention(kind: SessionStateKind): RowAttention | undefined
{
	if (kind === "awaiting") return "waiting";
	if (kind === "ready") return "unread";
	return undefined;
}

export type RowAttention = "waiting" | "unread";

/** The row title's upstream `data-attention` value, or undefined when the row has no attention look. */
export function useRowAttention(session: SessionListItem): RowAttention | undefined
{
	return rowAttention(useRowIconKind(session).kind);
}
