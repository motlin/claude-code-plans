import { useLayoutEffect, useRef } from "react";
import { File, FileCode, Folder } from "lucide-react";

import type { SessionFilesEntry } from "../lib/api/session-files";
import { isMutedMention } from "../lib/file-mentions";

const POPUP_CLASS =
  "absolute bottom-full left-0 z-[130] mb-2 flex max-h-96 w-[560px] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-card bg-[var(--menu-bg)] p-1 text-body text-primary shadow-[var(--menu-shadow)] select-none";

const ROW_CLASS =
  "flex w-full min-w-0 cursor-default items-center gap-2 rounded-r6 px-2.5 py-1.5 text-body outline-none data-[highlighted]:bg-fill-ghost-hover data-[muted]:text-muted";

const SOURCE_EXTENSION =
  /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|scala|sh|zsh|bash|lua|sql|vue|svelte|css|scss|html)$/i;

function EntryIcon({ entry }: { entry: SessionFilesEntry }) {
  const Icon = entry.isDirectory ? Folder : SOURCE_EXTENSION.test(entry.name) ? FileCode : File;
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-secondary" />;
}

export function fileMentionOptionId(menuId: string, index: number): string {
  return `${menuId}-option-${index}`;
}

/**
 * The claude.ai/code "@" popup: a 560px "Mention suggestions" listbox above the
 * composer, one row per path (icon, basename, muted dirname). Keyboard focus
 * stays in the editor, which drives `highlighted` and `onAccept`.
 */
export function FileMentionMenu({
  id,
  entries,
  highlighted,
  onHighlight,
  onAccept,
}: {
  id: string;
  entries: readonly SessionFilesEntry[];
  highlighted: number;
  onHighlight: (index: number) => void;
  onAccept: (entry: SessionFilesEntry) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[data-highlighted]")
      ?.scrollIntoView?.({ block: "nearest" });
  }, [highlighted, entries]);

  return (
    <div
      ref={listRef}
      id={id}
      role="listbox"
      aria-label="Mention suggestions"
      className={POPUP_CLASS}
      onMouseDown={(e) => e.preventDefault()}
    >
      {entries.map((entry, index) => {
        const slash = entry.relPath.lastIndexOf("/");
        const dirname = slash === -1 ? "" : entry.relPath.slice(0, slash);
        return (
          <div
            key={entry.relPath}
            id={fileMentionOptionId(id, index)}
            role="option"
            aria-selected={index === highlighted}
            data-highlighted={index === highlighted ? "" : undefined}
            data-muted={isMutedMention(entry.relPath, entry.ignored) ? "" : undefined}
            className={ROW_CLASS}
            onMouseMove={() => {
              if (index !== highlighted) onHighlight(index);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              onAccept(entry);
            }}
          >
            <EntryIcon entry={entry} />
            <span className="shrink-0 truncate">{entry.name}</span>
            {dirname !== "" && (
              <span className="min-w-0 truncate text-footnote text-muted">{dirname}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
