import type {SessionListItem} from "../lib/api/sessions";
import {sessionRowIconKind, type SessionStateKind} from "../lib/session-state";
import {useForcedColors} from "../lib/forced-colors";
import {useReducedMotion} from "../lib/reduced-motion";
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

/** Upstream `UF`: rows hold still under reduced motion (OS query or root flag) or forced colors. */
export type AttentionMotion = "moving" | "still";

/** Upstream `UF()`, the sidebar's motion context: "still" under reduced motion or forced colors. */
function useAttentionMotion(): AttentionMotion
{
	const reduced = useReducedMotion();
	const forced = useForcedColors();
	return reduced || forced ? "still" : "moving";
}

/**
 * Upstream `vW`'s attention look for a row title: none on an archived row (upstream maps it to
 * idle), waiting for awaiting, unread for ready, and working for running only while rows move.
 */
export function rowAttention({
	kind,
	archived,
	motion,
}: {
	kind: SessionStateKind;
	archived: boolean;
	motion: AttentionMotion;
}): RowAttention | undefined
{
	if (archived) return undefined;
	if (kind === "awaiting") return "waiting";
	if (kind === "ready") return "unread";
	if (kind === "running" && motion === "moving") return "working";
	return undefined;
}

export type RowAttention = "waiting" | "unread" | "working";

/** The row title's upstream `data-attention` value, or undefined when the row has no attention look. */
export function useRowAttention(session: SessionListItem, paneSelected: boolean): RowAttention | undefined
{
	const {kind} = useRowIconKind(session, paneSelected);
	const motion = useAttentionMotion();
	return rowAttention(
		{
			kind,
			archived: session.archived,
			motion,
		},
	);
}
