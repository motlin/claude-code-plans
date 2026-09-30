import {useNavigate} from "@tanstack/react-router";
import {useEffect, useSyncExternalStore} from "react";

import {useActiveSessionsIfAvailable} from "../hooks/use-claude-events";
import {findForkedSession, getPendingFork, setPendingFork, subscribePendingFork} from "../lib/session-fork";

interface StartedSession {
	sessionId: string;
	cwd: string;
	startedAt: number;
}

/** Opens a fork launched from any menu or shortcut once its SessionStart hook arrives. */
export function PendingForkNavigator({activeSessions}: {activeSessions: ReadonlyMap<string, StartedSession>}) {
	const pending = useSyncExternalStore(subscribePendingFork, getPendingFork, () => null);
	const navigate = useNavigate();

	useEffect(() => {
		if (pending === null) return;
		const id = findForkedSession(activeSessions.values(), pending);
		if (id === null) return;
		setPendingFork(null);
		void navigate({to: "/session/$id", params: {id}});
	}, [pending, activeSessions, navigate]);

	return null;
}

export function ForkNavigator() {
	return <PendingForkNavigator activeSessions={useActiveSessionsIfAvailable()} />;
}
