import { Copy, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react";

import { writeClipboardText } from "../../lib/clipboard";
import { formatResourceCount, resourceCoverageNote } from "../../lib/session-resources";
import {
  extractSessionFiles,
  getFileSourceKey,
  type FileEntry,
  type FileSourceKey,
  type SessionFiles,
} from "../../lib/session-files";
import type { SessionLine } from "../../lib/transcript";
import { JumpChips } from "../jump-chips";

export type FileSourceSelection = Record<FileSourceKey, boolean>;

export const FILE_SOURCE_SELECTION_STORAGE_KEY = "ccp-session-file-sources";

const FILE_SOURCE_OPTIONS: ReadonlyArray<{ key: FileSourceKey; label: string }> = [
  { key: "userMessage", label: "User message" },
  { key: "agentMessage", label: "Agent message" },
  { key: "read", label: "Read" },
  { key: "editWrite", label: "Edit/Write" },
  { key: "bash", label: "Bash" },
  { key: "grepGlob", label: "Grep/Glob" },
  { key: "thinking", label: "Thinking" },
  { key: "other", label: "Other" },
];

export const DEFAULT_FILE_SOURCE_SELECTION: FileSourceSelection = {
  userMessage: true,
  agentMessage: true,
  read: true,
  editWrite: true,
  bash: true,
  grepGlob: true,
  thinking: true,
  other: true,
};

const UNSELECTED_FILE_SOURCES: FileSourceSelection = {
  userMessage: false,
  agentMessage: false,
  read: false,
  editWrite: false,
  bash: false,
  grepGlob: false,
  thinking: false,
  other: false,
};

const EMPTY_SESSION_FILES: SessionFiles = {
  files: [],
  totalCount: 0,
  counts: {
    userMessage: 0,
    agentMessage: 0,
    read: 0,
    editWrite: 0,
    bash: 0,
    grepGlob: 0,
    thinking: 0,
    other: 0,
  },
};

function parseFileSourceSelection(rawValue: string): FileSourceSelection | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;

  const record = parsed as Record<string, unknown>;
  const keys = FILE_SOURCE_OPTIONS.map((option) => option.key);
  if (Object.keys(record).length !== keys.length) return undefined;
  if (!keys.every((key) => typeof record[key] === "boolean")) return undefined;

  return Object.fromEntries(keys.map((key) => [key, record[key]])) as FileSourceSelection;
}

/** The session-files source checkboxes, hydrated from and persisted to localStorage. */
function useFileSourceSelection() {
  const [sourceSelection, setSourceSelection] = useState<FileSourceSelection>(
    DEFAULT_FILE_SOURCE_SELECTION,
  );
  const [storageHydrated, setStorageHydrated] = useState(false);

  useEffect(() => {
    const storedSources = localStorage.getItem(FILE_SOURCE_SELECTION_STORAGE_KEY);
    if (storedSources !== null) {
      const parsedSources = parseFileSourceSelection(storedSources);
      if (parsedSources !== undefined) setSourceSelection(parsedSources);
    }
    setStorageHydrated(true);
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;
    localStorage.setItem(FILE_SOURCE_SELECTION_STORAGE_KEY, JSON.stringify(sourceSelection));
  }, [sourceSelection, storageHydrated]);

  const setSourceSelected = useCallback((source: FileSourceKey, selected: boolean) => {
    setSourceSelection((current) => ({ ...current, [source]: selected }));
  }, []);
  const unselectAllSources = useCallback(() => {
    setSourceSelection(UNSELECTED_FILE_SOURCES);
  }, []);

  return { sourceSelection, setSourceSelected, unselectAllSources };
}

export function useExtractedSessionFiles(
  lines: SessionLine[],
  homeRoot: string | undefined,
): SessionFiles {
  return useMemo(
    () => (homeRoot === undefined ? EMPTY_SESSION_FILES : extractSessionFiles(lines, homeRoot)),
    [homeRoot, lines],
  );
}

interface FileRowProps {
  file: FileEntry;
  copied: boolean;
  onCopy: (absolutePath: string) => Promise<void>;
}

function FileRow({ file, copied, onCopy }: FileRowProps) {
  return (
    <li className="border-b border-subtle px-3 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <span
          dir="rtl"
          title={file.path}
          className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left font-mono text-xs text-secondary"
        >
          <bdi>{file.path}</bdi>
        </span>
        <button
          type="button"
          aria-label={`Copy ${file.path}`}
          title={copied ? "Copied" : "Copy absolute path"}
          onClick={() => void onCopy(file.absolutePath)}
          className="flex size-6 shrink-0 items-center justify-center rounded text-t6 transition-colors hover:bg-fill-control hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100"
        >
          <Copy className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-1.5">
        <JumpChips occurrences={file.occurrences} />
      </div>
    </li>
  );
}

interface SessionFilesListProps {
  sessionFiles: SessionFiles;
  /** JSONL records before the loaded window, which extraction never saw. */
  unscannedRecordCount: number;
  filterRef: RefObject<HTMLInputElement | null>;
}

/**
 * The Files pane's local-only "Session files" column: every path the session
 * mentioned, filtered by source and by a substring of the canonical path, with
 * copy and jump-to-occurrence chips.
 */
export function SessionFilesList({
  sessionFiles,
  unscannedRecordCount,
  filterRef,
}: SessionFilesListProps) {
  const { sourceSelection, setSourceSelected, unselectAllSources } = useFileSourceSelection();
  const [searchText, setSearchText] = useState("");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const copiedTimeoutReference = useRef<number | undefined>(undefined);
  const coverageNote = resourceCoverageNote(unscannedRecordCount);

  const sourceFilteredFiles = useMemo(
    () =>
      sessionFiles.files.filter((file) =>
        file.occurrences.some((occurrence) => sourceSelection[getFileSourceKey(occurrence)]),
      ),
    [sessionFiles.files, sourceSelection],
  );
  const normalizedSearchText = searchText.trim().toLocaleLowerCase();
  const visibleFiles = useMemo(
    () =>
      normalizedSearchText === ""
        ? sourceFilteredFiles
        : sourceFilteredFiles.filter((file) =>
            file.path.toLocaleLowerCase().includes(normalizedSearchText),
          ),
    [normalizedSearchText, sourceFilteredFiles],
  );

  useEffect(
    () => () => {
      if (copiedTimeoutReference.current !== undefined) {
        window.clearTimeout(copiedTimeoutReference.current);
      }
    },
    [],
  );

  const copyPath = useCallback(async (absolutePath: string) => {
    setCopiedPath(null);
    const succeeded = await writeClipboardText(absolutePath);
    if (!succeeded) return;

    setCopiedPath(absolutePath);
    if (copiedTimeoutReference.current !== undefined) {
      window.clearTimeout(copiedTimeoutReference.current);
    }
    copiedTimeoutReference.current = window.setTimeout(() => setCopiedPath(null), 1_500);
  }, []);

  function handleSearchChange(event: ChangeEvent<HTMLInputElement>): void {
    setSearchText(event.target.value);
  }

  const emptyMessage =
    sourceFilteredFiles.length === 0
      ? "No files match the selected sources."
      : `No files match “${searchText}”.`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center px-2">
        <label className="relative block w-full">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-t6"
            aria-hidden="true"
          />
          <input
            ref={filterRef}
            type="search"
            aria-label="Filter files"
            spellCheck={false}
            autoComplete="off"
            value={searchText}
            onChange={handleSearchChange}
            placeholder="Search files…"
            className="h-6 w-full rounded-md border border-strong bg-surface-1 pl-7 pr-2 text-xs text-primary outline-none placeholder:text-t6 focus:border-accent-100/60"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {coverageNote !== undefined && (
          <p
            role="note"
            className="border-b border-border bg-fill-ghost-hover px-3 py-2 text-[11px] text-t6"
          >
            {coverageNote}
          </p>
        )}
        <section className="border-b border-border p-3" aria-labelledby="file-sources-heading">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 id="file-sources-heading" className="text-xs font-semibold text-secondary">
              Session files{" "}
              <span
                aria-label={
                  coverageNote === undefined
                    ? `${sessionFiles.totalCount} items`
                    : `${sessionFiles.totalCount} items in the loaded messages`
                }
                className="rounded-full bg-fill-control px-1.5 py-0.5 font-medium"
              >
                {formatResourceCount(sessionFiles.totalCount, unscannedRecordCount)}
              </span>
            </h3>
            <button
              type="button"
              onClick={unselectAllSources}
              className="text-xs text-t6 transition-colors hover:text-primary"
            >
              Unselect all
            </button>
          </div>
          <div className="grid grid-cols-1 gap-y-1.5">
            {FILE_SOURCE_OPTIONS.map((option) => (
              <label
                key={option.key}
                className="flex min-w-0 items-center gap-2 text-xs text-secondary"
              >
                <input
                  type="checkbox"
                  checked={sourceSelection[option.key]}
                  onChange={(event) => setSourceSelected(option.key, event.target.checked)}
                  className="size-3.5 shrink-0 accent-accent-100"
                />
                <span className="min-w-0 truncate">
                  {option.label} ({sessionFiles.counts[option.key]})
                </span>
              </label>
            ))}
          </div>
        </section>

        {visibleFiles.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-t6">{emptyMessage}</p>
        ) : (
          <ul>
            {visibleFiles.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                copied={copiedPath === file.absolutePath}
                onCopy={copyPath}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
