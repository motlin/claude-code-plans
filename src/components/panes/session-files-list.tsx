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
import { resourceCoverageNote } from "../../lib/session-resources";
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

export const FILE_SOURCE_OPTIONS: ReadonlyArray<{ key: FileSourceKey; label: string }> = [
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
export function useFileSourceSelection() {
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

/** A session file's row label: relative to the working directory, absolute outside it. */
export function sessionFileLabel(absolutePath: string, cwd: string | undefined): string {
  if (cwd === undefined) return absolutePath;
  const root = cwd.replace(/\/+$/, "");
  if (root === "" || !absolutePath.startsWith(`${root}/`)) return absolutePath;
  return absolutePath.slice(root.length + 1);
}

interface FileRowProps {
  file: FileEntry;
  label: string;
  open: boolean;
  copied: boolean;
  onOpen: (absolutePath: string, options: { pin: boolean }) => void;
  onCopy: (absolutePath: string) => Promise<void>;
}

function FileRow({ file, label, open, copied, onOpen, onCopy }: FileRowProps) {
  return (
    <li data-session-file className="group/file relative">
      <div className="flex h-6 items-center gap-1 rounded-r5 pr-1 hover:bg-fill-ghost-hover group-focus-within/file:bg-fill-ghost-hover">
        <button
          type="button"
          data-session-file-open
          dir="rtl"
          title={file.absolutePath}
          aria-current={open ? "true" : undefined}
          onClick={() => onOpen(file.absolutePath, { pin: false })}
          onDoubleClick={() => onOpen(file.absolutePath, { pin: true })}
          className="min-w-0 flex-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap bg-transparent pl-2 text-left text-body text-primary outline-none aria-[current=true]:font-medium"
        >
          <bdi>{label}</bdi>
        </button>
        <button
          type="button"
          aria-label={`Copy ${file.absolutePath}`}
          title={copied ? "Copied" : "Copy absolute path"}
          onClick={() => void onCopy(file.absolutePath)}
          className="flex size-5 shrink-0 items-center justify-center rounded text-t6 opacity-0 transition-colors group-hover/file:opacity-100 group-focus-within/file:opacity-100 hover:bg-fill-control hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100"
        >
          <Copy className="size-3" aria-hidden="true" />
        </button>
      </div>
      <div
        data-jump-popover
        className="absolute top-full left-2 z-20 hidden max-w-[calc(100%-1rem)] rounded-card bg-surface-3 p-1.5 shadow-panel group-hover/file:block group-focus-within/file:block"
      >
        <JumpChips occurrences={file.occurrences} />
      </div>
    </li>
  );
}

interface SessionFilesListProps {
  sessionFiles: SessionFiles;
  /** JSONL records before the loaded window, which extraction never saw. */
  unscannedRecordCount: number;
  sourceSelection: FileSourceSelection;
  /** Rows show paths relative to it; absolute when outside or unknown. */
  cwd: string | undefined;
  query: string;
  onQueryChange: (query: string) => void;
  filterRef: RefObject<HTMLInputElement | null>;
  openPath: string | null;
  /** A single click opens a preview tab; a double-click pins it. */
  onOpenFile: (absolutePath: string, options: { pin: boolean }) => void;
}

/**
 * The Files pane's local-only "Session" list: every path the session
 * mentioned, filtered by source (the ⋯ "Show files from" submenu) and by a
 * substring of the row label, with copy and hover jump-to-occurrence chips.
 */
export function SessionFilesList({
  sessionFiles,
  unscannedRecordCount,
  sourceSelection,
  cwd,
  query,
  onQueryChange,
  filterRef,
  openPath,
  onOpenFile,
}: SessionFilesListProps) {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const copiedTimeoutReference = useRef<number | undefined>(undefined);
  const coverageNote = resourceCoverageNote(unscannedRecordCount);

  const sourceFilteredFiles = useMemo(
    () =>
      sessionFiles.files
        .filter((file) =>
          file.occurrences.some((occurrence) => sourceSelection[getFileSourceKey(occurrence)]),
        )
        .map((file) => ({ file, label: sessionFileLabel(file.absolutePath, cwd) })),
    [cwd, sessionFiles.files, sourceSelection],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleFiles = useMemo(
    () =>
      normalizedQuery === ""
        ? sourceFilteredFiles
        : sourceFilteredFiles.filter(({ label }) =>
            label.toLocaleLowerCase().includes(normalizedQuery),
          ),
    [normalizedQuery, sourceFilteredFiles],
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

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>): void {
    onQueryChange(event.target.value);
  }

  const emptyMessage =
    sourceFilteredFiles.length === 0
      ? "No files match the selected sources."
      : `No files match “${query}”.`;

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
            value={query}
            onChange={handleQueryChange}
            placeholder="Search files…"
            className="h-6 w-full rounded-md border border-strong bg-surface-1 pl-7 pr-2 text-xs text-primary outline-none placeholder:text-t6 focus:border-accent-100/60"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1.25">
        {coverageNote !== undefined && (
          <p
            role="note"
            className="mb-1 rounded-r5 bg-fill-ghost-hover px-2 py-1.5 text-footnote text-t6"
          >
            {coverageNote}
          </p>
        )}
        {visibleFiles.length === 0 ? (
          <p className="px-2 py-1.5 text-footnote text-t6">{emptyMessage}</p>
        ) : (
          <ul aria-label="Session files">
            {visibleFiles.map(({ file, label }) => (
              <FileRow
                key={file.path}
                file={file}
                label={label}
                open={openPath === file.absolutePath}
                copied={copiedPath === file.absolutePath}
                onOpen={onOpenFile}
                onCopy={copyPath}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
