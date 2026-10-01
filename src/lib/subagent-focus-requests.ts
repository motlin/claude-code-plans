import {saveSubagentPaneAgent} from "./pane-layout";

type Listener = (agentId: string) => void;

const listeners = new Map<string, Set<Listener>>();
const pendingBySession = new Map<string, string>();

/**
 * Ask the session's Subagent pane to show `agentId`. A mounted pane switches at
 * once; otherwise the pane takes the request when it mounts.
 */
export function requestSubagentFocus(sessionId: string, agentId: string): void {
	saveSubagentPaneAgent(sessionId, agentId);
	const sessionListeners = listeners.get(sessionId);
	if (sessionListeners === undefined || sessionListeners.size === 0) {
		pendingBySession.set(sessionId, agentId);
		return;
	}
	for (const listener of sessionListeners) listener(agentId);
}

/** Take the request made while the session's Subagent pane was closed, if any. */
export function takePendingSubagentFocus(sessionId: string): string | null {
	const agentId = pendingBySession.get(sessionId) ?? null;
	pendingBySession.delete(sessionId);
	return agentId;
}

export function onSubagentFocusRequest(sessionId: string, listener: Listener): () => void {
	const sessionListeners = listeners.get(sessionId) ?? new Set();
	sessionListeners.add(listener);
	listeners.set(sessionId, sessionListeners);
	return () => {
		sessionListeners.delete(listener);
		if (sessionListeners.size === 0) listeners.delete(sessionId);
	};
}
