import {useCallback, useState} from "react";

import {useToast} from "../components/toast-context";
import {useRenameSessionMutation} from "../lib/api/sessions";

export const RENAME_FAILED_MESSAGE = "Couldn’t save the new name. Try again.";

export interface SessionRename
{
	/** The title to show: the pending name while a save is in flight or landing. */
	title: string;
	/** The inline input's starting text: the title, or empty while the title only stands in (upstream `MJ`, `ownTitle`). */
	initialValue: string;
	editing: boolean;
	startEditing: () => void;
	commit: (value: string) => void;
	cancel: () => void;
}

/**
 * Inline rename state for one session title. A commit shows the new name at
 * once and keeps it until the server's title moves off the one it replaced;
 * a failed save rolls back and toasts upstream's error copy. A stand-in title (the folder or "Untitled") is not
 * the session's own, so renaming it starts from an empty field.
 */
export function useSessionRename(sessionId: string, serverTitle: string, titleIsStandIn = false): SessionRename
{
	const toast = useToast();
	const mutation = useRenameSessionMutation(sessionId);
	const [editing, setEditing] = useState(false);
	const [pending, setPending] = useState<
	{
		title: string;
		replaces: string;
	} | null>(null);
	const pendingApplies = pending?.replaces === serverTitle;
	const title = pendingApplies ? pending.title : serverTitle;
	const initialValue = titleIsStandIn && !pendingApplies ? "" : title;

	const commit = useCallback(
		(value: string) =>
		{
			setEditing(false);
			const next = value.trim();
			if (next === "" || next === initialValue) return;
			const optimistic =
			{
				title: next,
				replaces: serverTitle,
			};
			setPending(optimistic);
			mutation.mutate(
				next,
				{
					onError: () =>
					{
						setPending((current) => (current === optimistic ? null : current));
						toast(
							{
								kind: "error",
								message: RENAME_FAILED_MESSAGE,
							},
						);
					},
				},
			);
		},
		[initialValue, mutation, serverTitle, toast],
	);

	const startEditing = useCallback(() =>
	{
		setEditing(true);
	}, []);
	const cancel = useCallback(() =>
	{
		setEditing(false);
	}, []);

	return {
		title,
		initialValue,
		editing,
		startEditing,
		commit,
		cancel,
	};
}
