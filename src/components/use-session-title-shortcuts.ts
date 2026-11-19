import {useQueryClient} from "@tanstack/react-query";
import {useSessionArchive} from "../hooks/use-session-archive";
import {useSessionFork} from "../hooks/use-session-fork";
import {useShortcut} from "../hooks/use-shortcut";
import {usePins} from "../lib/pin-store";
import {copySessionLink, openPullRequest} from "../lib/session-open-in";
import {useSessionRenameRequest} from "../lib/session-rename-request";
import {toggleUnseen} from "../lib/unread-store";
import {useToast} from "./toast-context";

/**
 * The session page's title shortcuts: ⌥⌘R (and ⌘K's Rename command) renames;
 * ⌥⌘A archives the session unless it is pinned or already archived; ⌥⌘U marks
 * it read/unread; ⌥⌘L copies its link; ⌥⌘G opens its pull request when the
 * transcript has a `pr-link` record; ⌥⌘O forks it.
 */
export function useSessionTitleShortcuts({
	sessionId,
	archived,
	prUrl,
	cwd = null,
	startEditing,
}: SessionTitleShortcutOptions): void
{
	const queryClient = useQueryClient();
	const setArchived = useSessionArchive(sessionId);
	const toast = useToast();
	const fork = useSessionFork();
	const {isPinned} = usePins();
	useShortcut("rename_session", () =>
	{
		startEditing();
	});
	// Upstream's chord is a no-op (and lets the key through) on a pinned or archived session.
	useShortcut(
		"archive_session",
		() =>
		{
			setArchived(true);
		},
		{
			disabled: archived || isPinned(sessionId),
		},
	);
	useShortcut("toggle_read_session", () =>
	{
		toggleUnseen(sessionId);
	});
	useShortcut("copy_session_link", () => void copySessionLink(sessionId, toast, queryClient));
	useShortcut(
		"open_session_pr",
		() =>
		{
			if (prUrl !== undefined) openPullRequest(prUrl);
		},
		{
			disabled: prUrl === undefined,
		},
	);
	useShortcut(
		"fork_session",
		() =>
		{
			if (cwd !== null)
				fork(
					{
						sessionId,
						cwd,
					},
				);
		},
		{
			disabled: cwd === null,
		},
	);
	useSessionRenameRequest(sessionId, startEditing);
}

export interface SessionTitleShortcutOptions
{
	sessionId: string;
	archived: boolean;
	prUrl?: string | undefined;
	/** The session's directory; forking needs it. */
	cwd?: string | null;
	startEditing: () => void;
}
