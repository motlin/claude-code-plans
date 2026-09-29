import { useSessionArchive } from "../hooks/use-session-archive";
import { useShortcut } from "../hooks/use-shortcut";
import { useSessionRename } from "../hooks/use-session-rename";
import { useSessionRenameRequest } from "../lib/session-rename-request";
import { ArchivedBadge } from "./archived-badge";
import { InlineRenameInput } from "./inline-rename-input";

/**
 * The session page title, which is also claude.ai/code's rename button:
 * clicking it (or ⌥⌘R anywhere on the page, or ⌘K's Rename command) swaps it for an inline input.
 * ⌥⌘A archives the session (or unarchives it when it already is).
 */
export function SessionTitleHeading({
  sessionId,
  title,
  archived,
}: {
  sessionId: string;
  title: string;
  archived: boolean;
}) {
  const rename = useSessionRename(sessionId, title);
  const setArchived = useSessionArchive(sessionId);
  useShortcut("rename_session", () => rename.startEditing());
  useShortcut("archive_session", () => setArchived(!archived));
  useSessionRenameRequest(sessionId, rename.startEditing);

  return (
    <h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
      {rename.editing ? (
        <InlineRenameInput value={rename.title} onCommit={rename.commit} onCancel={rename.cancel} />
      ) : (
        <button
          type="button"
          aria-label={`${rename.title}, rename session`}
          title="Rename"
          onClick={rename.startEditing}
          className="min-w-0 cursor-text truncate rounded-r6 text-left hover:bg-fill-ghost-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
        >
          {rename.title}
        </button>
      )}
      {archived && <ArchivedBadge />}
    </h1>
  );
}
