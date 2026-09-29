import { useShortcut } from "../hooks/use-shortcut";
import { useSessionRename } from "../hooks/use-session-rename";
import { InlineRenameInput } from "./inline-rename-input";

/**
 * The session page title, which is also claude.ai/code's rename button:
 * clicking it (or ⌥⌘R anywhere on the page) swaps it for an inline input.
 */
export function SessionTitleHeading({ sessionId, title }: { sessionId: string; title: string }) {
  const rename = useSessionRename(sessionId, title);
  useShortcut("rename_session", () => rename.startEditing());

  return (
    <h1 className="flex min-w-0 text-lg font-semibold">
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
    </h1>
  );
}
