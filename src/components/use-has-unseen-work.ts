import {useCallback, useSyncExternalStore} from "react";
import {hasUnseenWork, subscribeUnseenWork, unseenWorkVersion} from "../lib/unread-store";

export function useHasUnseenWork(sessionId: string): boolean
{
	const getSnapshot = useCallback(() => hasUnseenWork(sessionId), [sessionId]);
	return useSyncExternalStore(subscribeUnseenWork, getSnapshot, () => false);
}

/** Re-renders on any unread-store change, including an explicit-unread bit flipping on its own. */
export function useUnseenWorkVersion(): number
{
	return useSyncExternalStore(subscribeUnseenWork, unseenWorkVersion, () => 0);
}
