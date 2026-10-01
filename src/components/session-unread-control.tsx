import {useCallback, useSyncExternalStore} from "react";

import type {SessionListItem} from "../lib/api/sessions";
import {prGlyph} from "../lib/pr-status";
import {sessionMenuReadState} from "../lib/session-menu-items";
import {sessionRowIconKind} from "../lib/session-state";
import {hasUnseenWork, subscribeUnseenWork, toggleUnseen} from "../lib/unread-store";
import {useSettings} from "./settings-provider";
import {SessionStateIcon} from "./status-dot";
import {Tooltip} from "./ui/tooltip";

export function useHasUnseenWork(sessionId: string): boolean {
	const getSnapshot = useCallback(() => hasUnseenWork(sessionId), [sessionId]);
	return useSyncExternalStore(subscribeUnseenWork, getSnapshot, () => false);
}

/**
 * Upstream session row status dot. Awaiting and running glyphs carry a top tooltip, a read finished
 * row's glyph is a plain icon, and only the unread dot is a button that marks the row read
 * (the row menu's "Mark as unread" handles the other direction).
 */
export function SessionRowStatusDot({session, tabIndex}: {session: SessionListItem; tabIndex?: number}) {
	const unseen = useHasUnseenWork(session.id);
	const {settings} = useSettings();
	// The server bucket lags a manual toggle until the next summary arrives, so a finished
	// row's icon follows the local unseen flag.
	const kind = sessionRowIconKind({
		bucket: session.bucket,
		unseen,
		serverUnseen: session.unseen,
		prStatus: session.prStatus,
		showPrStatus: settings.sessionListPrefs.showPrStatus,
	});
	const readState = sessionMenuReadState(session.bucket, unseen);
	const icon = (
		<SessionStateIcon
			kind={kind}
			{...(kind === "pr" && session.prStatus !== undefined ? {pr: prGlyph(session.prStatus)} : {})}
		/>
	);
	if (readState === "working" || readState === "awaiting") {
		return <Tooltip content={readState === "awaiting" ? "Awaiting input" : "Running"}>{icon}</Tooltip>;
	}
	if (readState === "read") return icon;

	const label = "Click to mark as read";
	return (
		<Tooltip content={label}>
			<button
				type="button"
				{...(tabIndex === undefined ? {} : {tabIndex})}
				aria-label={label}
				className="flex cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					toggleUnseen(session.id);
				}}
			>
				{icon}
			</button>
		</Tooltip>
	);
}
