import { useSessionArchive } from "../hooks/use-session-archive";
import { useSessionFork } from "../hooks/use-session-fork";
import { useShortcut } from "../hooks/use-shortcut";
import { type SessionRename, useSessionRename } from "../hooks/use-session-rename";
import { copySessionLink, openPullRequest } from "../lib/session-open-in";
import { useSessionRenameRequest } from "../lib/session-rename-request";
import { toggleUnseen } from "../lib/unread-store";
import { ArchivedBadge } from "./archived-badge";
import { InlineRenameInput } from "./inline-rename-input";
import { useToast } from "./toast";

export interface SessionTitleShortcutOptions {
  sessionId: string;
  archived: boolean;
  prUrl?: string | undefined;
  /** The session's directory; forking needs it. */
  cwd?: string | null;
  startEditing: () => void;
}

/**
 * The session page's title shortcuts: ⌥⌘R (and ⌘K's Rename command) renames;
 * ⌥⌘A archives the session (or unarchives it when it already is); ⌥⌘U marks
 * it read/unread; ⌥⌘L copies its link; ⌥⌘G opens its pull request when the
 * transcript has a `pr-link` record; ⌥⌘O forks it.
 */
export function useSessionTitleShortcuts({
  sessionId,
  archived,
  prUrl,
  cwd = null,
  startEditing,
}: SessionTitleShortcutOptions): void {
  const setArchived = useSessionArchive(sessionId);
  const toast = useToast();
  const fork = useSessionFork();
  useShortcut("rename_session", () => startEditing());
  useShortcut("archive_session", () => setArchived(!archived));
  useShortcut("toggle_read_session", () => toggleUnseen(sessionId));
  useShortcut("copy_session_link", () => void copySessionLink(sessionId, toast));
  useShortcut(
    "open_session_pr",
    () => {
      if (prUrl !== undefined) openPullRequest(prUrl);
    },
    { disabled: prUrl === undefined },
  );
  useShortcut(
    "fork_session",
    () => {
      if (cwd !== null) fork({ sessionId, cwd });
    },
    { disabled: cwd === null },
  );
  useSessionRenameRequest(sessionId, startEditing);
}

/** claude.ai/code's rename button: clicking it swaps the title for an inline input. */
export function SessionTitleButton({
  rename,
  className,
}: {
  rename: SessionRename;
  className: string;
}) {
  if (rename.editing) {
    return (
      <InlineRenameInput value={rename.title} onCommit={rename.commit} onCancel={rename.cancel} />
    );
  }
  return (
    <button
      type="button"
      aria-label={`${rename.title}, rename session`}
      title="Rename"
      onClick={rename.startEditing}
      className={className}
    >
      {rename.title}
    </button>
  );
}

/** A standalone heading form of the session title with its shortcuts. */
export function SessionTitleHeading({
  sessionId,
  title,
  archived,
  prUrl,
  cwd = null,
}: {
  sessionId: string;
  title: string;
  archived: boolean;
  prUrl?: string | undefined;
  /** The session's directory; forking needs it. */
  cwd?: string | null;
}) {
  const rename = useSessionRename(sessionId, title);
  useSessionTitleShortcuts({ sessionId, archived, prUrl, cwd, startEditing: rename.startEditing });

  return (
    <h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
      <SessionTitleButton
        rename={rename}
        className="min-w-0 cursor-text truncate rounded-r6 text-left hover:bg-fill-ghost-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
      />
      {archived && <ArchivedBadge />}
    </h1>
  );
}
