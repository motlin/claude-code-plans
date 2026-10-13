import {useCallback, useSyncExternalStore} from "react";
import {hasUnseenWork, subscribeUnseenWork} from "../lib/unread-store";

export function useHasUnseenWork(sessionId: string): boolean {
	const getSnapshot = useCallback(() => hasUnseenWork(sessionId), [sessionId]);
	return useSyncExternalStore(subscribeUnseenWork, getSnapshot, () => false);
}
