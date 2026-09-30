import {useCallback, useSyncExternalStore} from "react";

import type {SessionListItem} from "../lib/api/sessions";
import {prGlyph} from "../lib/pr-status";
import {sessionMenuReadState} from "../lib/session-menu-items";
import {sessionRowIconKind} from "../lib/session-state";
import {hasUnseenWork, subscribeUnseenWork, toggleUnseen} from "../lib/unread-store";
import {useSettings} from "./settings-provider";
import {SessionStateIcon} from "./status-dot";

export function useHasUnseenWork(sessionId: string): boolean {
	const getSnapshot = useCallback(() => hasUnseenWork(sessionId), [sessionId]);
	return useSyncExternalStore(subscribeUnseenWork, getSnapshot, () => false);
}

/**
 * Upstream session row status dot. On a finished row it is also the read/unread toggle
 * ("Click to mark as read" / "Click to mark as unread"); working and waiting rows show a plain icon.
 */
export function SessionRowStatusDot({session}: {session: SessionListItem}) {
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
	if (readState === "working" || readState === "awaiting") return <SessionStateIcon kind={kind} />;

	const label = readState === "unread" ? "Click to mark as read" : "Click to mark as unread";
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			className="flex cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				toggleUnseen(session.id);
			}}
		>
			<SessionStateIcon
				kind={kind}
				{...(kind === "pr" && session.prStatus !== undefined ? {pr: prGlyph(session.prStatus)} : {})}
			/>
		</button>
	);
}
