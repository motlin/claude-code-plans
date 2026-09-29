import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useRef } from "react";

import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { fileSearchQueryOptions } from "../../lib/api/search";
import {
  askAboutPrompt,
  type ContentSearchMatch,
  groupContentSearchResults,
  type MarkedText,
} from "../../lib/files-content-search";
import { getFileIcon } from "../file-tree";

const QUERY_DEBOUNCE_MS = 120;

export interface ContentMatchOpenOptions {
  pin: boolean;
  line?: number;
  findQuery?: string;
}

interface ContentSearchResultsProps {
  /** The content query, without the leading "?". */
  query: string;
  cwd: string;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Set to a function that focuses the first match; false when there is none. */
  focusFirstRef: RefObject<(() => boolean) | null>;
  onOpenFile?: ((relPath: string, options: ContentMatchOpenOptions) => void) | undefined;
  /** Puts the "Ask about this" prompt into the chat input, unsent. */
  onAsk?: ((prompt: string) => void) | undefined;
}

function Snippet({ snippet }: { snippet: MarkedText }) {
  const { text, match } = snippet;
  if (match === null) return <>{text}</>;
  return (
    <>
      {text.slice(0, match.start)}
      <mark className="rounded-r3 bg-accent-100/25 text-primary">
        {text.slice(match.start, match.end)}
      </mark>
      {text.slice(match.end)}
    </>
  );
}

function fileName(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf("/") + 1);
}

function parentDir(relPath: string): string {
  const lastSlash = relPath.lastIndexOf("/");
  return lastSlash === -1 ? "" : relPath.slice(0, lastSlash);
}

/**
 * The Files filter's "?" mode: matches from the indexed file contents under
 * the working directory, grouped per file with windowed snippets.
 */
export function ContentSearchResults({
  query,
  cwd,
  inputRef,
  focusFirstRef,
  onOpenFile,
  onAsk,
}: ContentSearchResultsProps) {
  const debouncedQuery = useDebouncedValue(query, QUERY_DEBOUNCE_MS);
  const search = useQuery({
    ...fileSearchQueryOptions(debouncedQuery, cwd),
    enabled: debouncedQuery !== "",
    placeholderData: keepPreviousData,
  });
  const listRef = useRef<HTMLDivElement>(null);

  const results =
    search.data === undefined ? null : groupContentSearchResults(search.data, cwd, debouncedQuery);
  const rows: Array<{ relPath: string; match: ContentSearchMatch }> =
    results?.groups.flatMap((group) =>
      group.matches.map((match) => ({ relPath: group.relPath, match })),
    ) ?? [];

  function focusRow(index: number): void {
    listRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)?.focus();
  }

  useEffect(() => {
    focusFirstRef.current = () => {
      if (rows.length === 0) return false;
      focusRow(0);
      return true;
    };
    return () => {
      focusFirstRef.current = null;
    };
  });

  function openMatch(relPath: string, match: ContentSearchMatch): void {
    onOpenFile?.(relPath, { pin: false, line: match.line, findQuery: debouncedQuery });
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(Math.min(rows.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) inputRef.current?.focus();
      else focusRow(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusRow(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusRow(rows.length - 1);
    } else if (event.key === "Enter") {
      const row = rows[index];
      if (row === undefined) return;
      event.preventDefault();
      openMatch(row.relPath, row.match);
    }
  }

  let message: string | null = null;
  if (query === "") message = "Type after ? to search file contents";
  else if (search.isError && search.data === undefined) message = "Couldn’t search file contents.";
  else if (results === null) message = "Searching files";
  else if (results.groups.length === 0) message = "No matches in file contents";

  if (message !== null) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1.25">
        <p className="px-2 py-1.5 text-footnote text-ink-muted select-none">{message}</p>
      </div>
    );
  }

  let rowIndex = 0;
  return (
    <div
      ref={listRef}
      role="tree"
      aria-label="File content matches"
      className="min-h-0 flex-1 overflow-y-auto px-1 py-1.25 outline-none"
    >
      {results?.groups.map((group) => {
        const Icon = getFileIcon(fileName(group.relPath));
        const dir = parentDir(group.relPath);
        return (
          <div key={group.path} role="group" aria-label={group.relPath} className="pb-1">
            <button
              type="button"
              tabIndex={-1}
              data-content-file
              title={group.relPath}
              onClick={() => onOpenFile?.(group.relPath, { pin: false })}
              onDoubleClick={() => onOpenFile?.(group.relPath, { pin: true })}
              className="flex h-6 w-full min-w-0 cursor-pointer items-baseline gap-1 rounded-r5 border-0 bg-transparent pr-2 pl-2 text-left text-body outline-none select-none hover:bg-fill-ghost-hover"
            >
              <Icon aria-hidden="true" className="size-3 shrink-0 self-center text-ink-muted" />
              <span className="truncate text-primary">{fileName(group.relPath)}</span>
              {dir !== "" && (
                <span className="min-w-0 truncate text-footnote text-ink-muted">{dir}</span>
              )}
            </button>
            {group.matches.map((match) => {
              const index = rowIndex;
              rowIndex += 1;
              return (
                <div
                  key={match.line}
                  role="treeitem"
                  aria-level={2}
                  aria-selected={false}
                  tabIndex={-1}
                  data-content-match
                  data-row-index={index}
                  onKeyDown={(event) => handleRowKeyDown(event, index)}
                  onClick={() => openMatch(group.relPath, match)}
                  className="group/match flex min-h-6 cursor-pointer items-baseline gap-2 rounded-r5 py-0.5 pr-1 pl-6 text-footnote outline-none hover:bg-fill-ghost-hover focus-visible:bg-fill-ghost-hover"
                >
                  <span className="shrink-0 font-mono text-ink-muted tabular-nums">
                    {match.line}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-secondary">
                    <Snippet snippet={match.snippet} />
                  </span>
                  {onAsk !== undefined && (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Ask about this"
                      title="Ask about this"
                      onClick={(event) => {
                        event.stopPropagation();
                        onAsk(askAboutPrompt(group.relPath, match.line, match.text));
                      }}
                      className="flex size-5 shrink-0 cursor-pointer items-center justify-center self-center rounded-r3 text-t6 opacity-0 group-hover/match:opacity-100 group-focus-visible/match:opacity-100 hover:text-primary"
                    >
                      <MessageSquare aria-hidden="true" className="size-3" />
                    </button>
                  )}
                </div>
              );
            })}
            {group.more && (
              <p data-content-more className="py-0.5 pl-6 text-footnote text-ink-muted select-none">
                More matches in this file.
              </p>
            )}
          </div>
        );
      })}
      {results?.capped === true && (
        <p className="px-2 py-1.5 text-footnote text-ink-muted select-none">
          {`Only ${results.shownCount} matches are shown. Keep typing to narrow.`}
        </p>
      )}
    </div>
  );
}
