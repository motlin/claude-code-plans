import {useCallback, useState} from "react";

import {useToast} from "../components/toast";
import {useRenameSessionMutation} from "../lib/api/sessions";

const RENAME_FAILED_MESSAGE = "Couldn’t save the new name. Try again.";

export interface SessionRename {
	/** The title to show: the pending name while a save is in flight or landing. */
	title: string;
	editing: boolean;
	startEditing: () => void;
	commit: (value: string) => void;
	cancel: () => void;
}

/**
 * Inline rename state for one session title. A commit shows the new name at
 * once and keeps it until the server's title moves off the one it replaced;
 * a failed save rolls back and toasts upstream's error copy.
 */
export function useSessionRename(sessionId: string, serverTitle: string): SessionRename {
	const toast = useToast();
	const mutation = useRenameSessionMutation(sessionId);
	const [editing, setEditing] = useState(false);
	const [pending, setPending] = useState<{title: string; replaces: string} | null>(null);
	const title = pending !== null && pending.replaces === serverTitle ? pending.title : serverTitle;

	const commit = useCallback(
		(value: string) => {
			setEditing(false);
			const next = value.trim();
			if (next === "" || next === title) return;
			const optimistic = {title: next, replaces: serverTitle};
			setPending(optimistic);
			mutation.mutate(next, {
				onError: () => {
					setPending((current) => (current === optimistic ? null : current));
					toast({kind: "error", message: RENAME_FAILED_MESSAGE});
				},
			});
		},
		[mutation, serverTitle, title, toast],
	);

	const startEditing = useCallback(() => setEditing(true), []);
	const cancel = useCallback(() => setEditing(false), []);

	return {title, editing, startEditing, commit, cancel};
}
