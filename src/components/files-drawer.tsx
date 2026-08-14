import { Copy, Files as FilesIcon, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import { writeClipboardText } from "../lib/clipboard";
import { formatResourceCount, resourceCoverageNote } from "../lib/session-resources";
import {
  extractSessionFiles,
  getFileSourceKey,
  type FileEntry,
  type FileSourceKey,
  type SessionFiles,
} from "../lib/session-files";
import type { SessionLine } from "../lib/transcript";
import { pillStyles } from "./detail-top-bar";
import { JumpChips } from "./jump-chips";
import { SessionDrawer } from "./session-drawer";

export type FileSourceSelection = Record<FileSourceKey, boolean>;
type OpenSessionDrawer = "none" | "files" | "links";

export const OPEN_DRAWER_STORAGE_KEY = "ccp-session-open-drawer";
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

export function useFilesDrawerState() {
  const [openDrawer, setOpenDrawer] = useState<OpenSessionDrawer>("none");
  const [sourceSelection, setSourceSelection] = useState<FileSourceSelection>(
    DEFAULT_FILE_SOURCE_SELECTION,
  );
  const [storageHydrated, setStorageHydrated] = useState(false);

  useEffect(() => {
    const storedDrawer = localStorage.getItem(OPEN_DRAWER_STORAGE_KEY);
    setOpenDrawer(
      storedDrawer === "files" || storedDrawer === "links" || storedDrawer === "none"
        ? storedDrawer
        : "none",
    );

    const storedSources = localStorage.getItem(FILE_SOURCE_SELECTION_STORAGE_KEY);
    if (storedSources !== null) {
      const parsedSources = parseFileSourceSelection(storedSources);
      if (parsedSources !== undefined) setSourceSelection(parsedSources);
    }
    setStorageHydrated(true);
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;
    localStorage.setItem(OPEN_DRAWER_STORAGE_KEY, openDrawer);
    localStorage.setItem(FILE_SOURCE_SELECTION_STORAGE_KEY, JSON.stringify(sourceSelection));
  }, [openDrawer, sourceSelection, storageHydrated]);

  const toggleFilesDrawer = useCallback(() => {
    setOpenDrawer((current) => (current === "files" ? "none" : "files"));
  }, []);
  const toggleLinksDrawer = useCallback(() => {
    setOpenDrawer((current) => (current === "links" ? "none" : "links"));
  }, []);
  const closeDrawer = useCallback(() => setOpenDrawer("none"), []);
  const setSourceSelected = useCallback((source: FileSourceKey, selected: boolean) => {
    setSourceSelection((current) => ({ ...current, [source]: selected }));
  }, []);
  const unselectAllSources = useCallback(() => {
    setSourceSelection(UNSELECTED_FILE_SOURCES);
  }, []);

  return {
    openDrawer,
    sourceSelection,
    toggleFilesDrawer,
    toggleLinksDrawer,
    closeDrawer,
    setSourceSelected,
    unselectAllSources,
  };
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

interface FilesDrawerToggleProps {
  count: number;
  /** JSONL records before the loaded window, which `count` never saw. */
  unscannedRecordCount?: number;
  isOpen: boolean;
  onToggle: () => void;
}

export function FilesDrawerToggle({
  count,
  unscannedRecordCount = 0,
  isOpen,
  onToggle,
}: FilesDrawerToggleProps) {
  return (
    <button
      type="button"
      disabled={count === 0}
      aria-expanded={isOpen}
      title={resourceCoverageNote(unscannedRecordCount)}
      onClick={onToggle}
      className={`${pillStyles.outline} disabled:cursor-not-allowed disabled:opacity-40 ${isOpen ? "bg-surface-0 text-primary" : ""}`}
    >
      <FilesIcon className="h-3.5 w-3.5" aria-hidden="true" />
      Files {formatResourceCount(count, unscannedRecordCount)}
    </button>
  );
}

interface FilesDrawerProps {
  sessionFiles: SessionFiles;
  /** JSONL records before the loaded window, which extraction never saw. */
  unscannedRecordCount?: number;
  sourceSelection: FileSourceSelection;
  onSourceSelected: (source: FileSourceKey, selected: boolean) => void;
  onUnselectAllSources: () => void;
  onClose: () => void;
}

interface FileRowProps {
  file: FileEntry;
  copied: boolean;
  onCopy: (absolutePath: string) => Promise<void>;
}

function FileRow({ file, copied, onCopy }: FileRowProps) {
  return (
    <li className="border-b border-subtle px-4 py-3 last:border-b-0">
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
          className="flex size-7 shrink-0 items-center justify-center rounded text-t6 transition-colors hover:bg-fill-control hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100"
        >
          <Copy className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2">
        <JumpChips occurrences={file.occurrences} />
      </div>
    </li>
  );
}

export function FilesDrawer({
  sessionFiles,
  unscannedRecordCount = 0,
  sourceSelection,
  onSourceSelected,
  onUnselectAllSources,
  onClose,
}: FilesDrawerProps) {
  const [searchText, setSearchText] = useState("");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const copiedTimeoutReference = useRef<number | undefined>(undefined);

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
    <SessionDrawer
      title="Files"
      count={sessionFiles.totalCount}
      unscannedRecordCount={unscannedRecordCount}
      onClose={onClose}
    >
      <section className="border-b border-border p-4" aria-labelledby="file-sources-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 id="file-sources-heading" className="text-xs font-semibold text-secondary">
            Sources
          </h3>
          <button
            type="button"
            onClick={onUnselectAllSources}
            className="text-xs text-t6 transition-colors hover:text-primary"
          >
            Unselect all
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {FILE_SOURCE_OPTIONS.map((option) => (
            <label
              key={option.key}
              className="flex min-w-0 items-center gap-2 text-xs text-secondary"
            >
              <input
                type="checkbox"
                checked={sourceSelection[option.key]}
                onChange={(event) => onSourceSelected(option.key, event.target.checked)}
                className="size-3.5 shrink-0 accent-accent-100"
              />
              <span className="min-w-0 truncate">
                {option.label} ({sessionFiles.counts[option.key]})
              </span>
            </label>
          ))}
        </div>
      </section>

      <div className="sticky top-0 z-10 border-b border-border bg-surface-0 p-3">
        <label className="relative block">
          <span className="sr-only">Filter files</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-t6"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchText}
            onChange={handleSearchChange}
            placeholder="Filter files"
            className="w-full rounded-md border border-strong bg-surface-1 py-2 pl-8 pr-3 text-xs text-primary outline-none placeholder:text-t6 focus:border-accent-100/60"
          />
        </label>
      </div>

      {visibleFiles.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-t6">{emptyMessage}</p>
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
    </SessionDrawer>
  );
}
