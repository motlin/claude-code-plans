import { useQuery } from "@tanstack/react-query";
import { EllipsisVertical, Files as FilesIcon, Folder, PanelLeft, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useShortcut, useShortcutKeys } from "../../hooks/use-shortcut";
import { sessionResourcesQueryOptions } from "../../lib/api/sessions";
import { formatResourceCount, resourceCoverageNote } from "../../lib/session-resources";
import type { SessionFiles } from "../../lib/session-files";
import { pillStyles } from "../detail-top-bar";
import { JumpTargetProvider, type JumpTargetWindow } from "../jump-target-context";
import { Menu, MenuCheckboxItem, MenuContent, MenuTrigger } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { type PaneChrome, registerPane } from "./pane-registry";
import { SessionFilesList } from "./session-files-list";
import { usePaneHost } from "./tile-host";

export {
  DEFAULT_FILE_SOURCE_SELECTION,
  FILE_SOURCE_SELECTION_STORAGE_KEY,
  useExtractedSessionFiles,
} from "./session-files-list";

const GHOST_ICON_BUTTON =
  "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary aria-pressed:bg-fill-control aria-pressed:text-primary";

export interface FilesEmptyState {
  title: string;
  detail: string;
}

/** Upstream's three viewer empty states, chosen by whether the tree shows and how many tabs are open. */
export function filesEmptyState(hasTree: boolean, tabCount: number): FilesEmptyState {
  if (tabCount > 0) {
    return {
      title: "No file selected",
      detail: "Pick an open file above, or click a file path in the conversation.",
    };
  }
  return {
    title: "Open files appear here",
    detail: hasTree
      ? "Pick a file in the tree, or click a file path in the conversation."
      : "Click a file path in the conversation to open it.",
  };
}

/**
 * Set by ⇧⌘F when it opens the pane, consumed by the pane's filter input on
 * mount: upstream focuses the filter only when the shortcut opened the pane.
 */
let pendingFilterFocus = false;

function consumePendingFilterFocus(): boolean {
  const pending = pendingFilterFocus;
  pendingFilterFocus = false;
  return pending;
}

function TreeToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const keys = useShortcutKeys("toggle_changes_file_list");
  const label = shown ? "Hide file tree" : "Show file tree";
  return (
    <Tooltip content={label} shortcut={keys.keys}>
      <button
        type="button"
        aria-pressed={shown}
        aria-label={label}
        aria-keyshortcuts={keys.ariaKeyShortcuts}
        onClick={onToggle}
        className={GHOST_ICON_BUTTON}
      >
        <PanelLeft aria-hidden="true" className="size-4" />
      </button>
    </Tooltip>
  );
}

function FilesSettingsMenu({
  treeShown,
  onTreeShownChange,
}: {
  treeShown: boolean;
  onTreeShownChange: (shown: boolean) => void;
}) {
  const treeKeys = useShortcutKeys("toggle_changes_file_list");
  return (
    <Menu>
      <MenuTrigger aria-label="Files settings" className={GHOST_ICON_BUTTON}>
        <EllipsisVertical aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuCheckboxItem
          checked={treeShown}
          onCheckedChange={onTreeShownChange}
          shortcut={treeKeys.keys}
        >
          Show file tree
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  );
}

function FilesEmpty({ hasTree, tabCount }: { hasTree: boolean; tabCount: number }) {
  const copy = filesEmptyState(hasTree, tabCount);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-4 text-center">
      <Folder aria-hidden="true" className="size-7 text-t6" />
      <div className="flex flex-col items-center gap-1">
        <p className="max-w-[36ch] text-pretty break-words text-body text-primary">{copy.title}</p>
        <p className="max-w-[36ch] text-pretty break-words text-footnote text-t6">{copy.detail}</p>
      </div>
    </div>
  );
}

interface FilesPaneViewProps {
  chrome: PaneChrome;
  sessionFiles: SessionFiles;
  /** JSONL records before the loaded window, which extraction never saw. */
  unscannedRecordCount: number;
}

/**
 * The Files pane surface, header included: tree toggle · "Files" · Move ·
 * Search files · Files settings · Expand · Close, over the tree column (for
 * now the local "Session files" list) and the viewer column.
 */
export function FilesPaneView({ chrome, sessionFiles, unscannedRecordCount }: FilesPaneViewProps) {
  const host = usePaneHost();
  const [treeShown, setTreeShown] = useState(true);
  const [focusRequest, setFocusRequest] = useState(0);
  const filterRef = useRef<HTMLInputElement>(null);

  useShortcut(
    "toggle_changes_file_list",
    () => {
      if (host.layout.focused !== "files") return false;
      setTreeShown((shown) => !shown);
      return true;
    },
    { priority: 1 },
  );

  useEffect(() => {
    if (consumePendingFilterFocus()) filterRef.current?.focus();
  }, []);

  useEffect(() => {
    if (focusRequest === 0) return;
    filterRef.current?.focus();
    filterRef.current?.select();
  }, [focusRequest]);

  function searchFiles(): void {
    setTreeShown(true);
    setFocusRequest((request) => request + 1);
  }

  return (
    <>
      <div
        data-files-header
        className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-1"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <TreeToggle shown={treeShown} onToggle={() => setTreeShown((shown) => !shown)} />
          <span data-pane-title className="truncate text-body text-secondary select-none">
            Files
          </span>
          {chrome.moveHandle}
        </div>
        <div className="relative flex shrink-0 items-center gap-0.5">
          <Tooltip content="Search files">
            <button
              type="button"
              aria-label="Search files"
              onClick={searchFiles}
              className={GHOST_ICON_BUTTON}
            >
              <Search aria-hidden="true" className="size-4" />
            </button>
          </Tooltip>
          <FilesSettingsMenu treeShown={treeShown} onTreeShownChange={setTreeShown} />
          {chrome.controls}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-b-[inherit]">
        {treeShown && (
          <div
            data-files-tree
            className="flex min-h-0 w-60 min-w-40 max-w-[50%] shrink-0 flex-col border-r border-border"
          >
            <SessionFilesList
              sessionFiles={sessionFiles}
              unscannedRecordCount={unscannedRecordCount}
              filterRef={filterRef}
            />
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <FilesEmpty hasTree={treeShown} tabCount={0} />
        </div>
      </div>
    </>
  );
}

interface FilesPaneProps {
  sessionId: string;
  chrome: PaneChrome;
  /** Extraction over the loaded transcript window, used until the full-session scan lands. */
  windowFiles: SessionFiles;
  /** JSONL records before the loaded window. */
  windowStartIndex: number;
  jumpTargetWindow: JumpTargetWindow;
}

function FilesPane({
  sessionId,
  chrome,
  windowFiles,
  windowStartIndex,
  jumpTargetWindow,
}: FilesPaneProps) {
  // A whole-session inventory costs a full pass over the JSONL, so only an
  // open Files pane asks for it.
  const resources = useQuery(sessionResourcesQueryOptions(sessionId, true)).data;
  return (
    <JumpTargetProvider value={jumpTargetWindow}>
      <FilesPaneView
        chrome={chrome}
        sessionFiles={resources?.files ?? windowFiles}
        unscannedRecordCount={resources === undefined ? windowStartIndex : 0}
      />
    </JumpTargetProvider>
  );
}

/** Registers the `files` pane kind for this session while mounted. */
export function useRegisterFilesPane({
  sessionId,
  windowFiles,
  windowStartIndex,
  jumpTargetWindow,
}: Omit<FilesPaneProps, "chrome">): void {
  useEffect(
    () =>
      registerPane("files", {
        title: "Files",
        header: "custom",
        render: (chrome) => (
          <FilesPane
            sessionId={sessionId}
            chrome={chrome}
            windowFiles={windowFiles}
            windowStartIndex={windowStartIndex}
            jumpTargetWindow={jumpTargetWindow}
          />
        ),
      }),
    [sessionId, windowFiles, windowStartIndex, jumpTargetWindow],
  );
}

/** Binds ⇧⌘F: toggle the Files pane, focusing its filter when it opens. */
export function FilesPaneShortcut() {
  const host = usePaneHost();
  useShortcut("toggle_files", () => {
    pendingFilterFocus = !host.isOpen("files");
    host.togglePane("files");
  });
  return null;
}

interface FilesPaneToggleProps {
  count: number;
  /** JSONL records before the loaded window, which `count` never saw. */
  unscannedRecordCount?: number;
}

/**
 * Titlebar pill for the Files pane, pressed while it is open. Upstream puts
 * "Files ⇧⌘F" in the View options menu, which does not exist locally yet.
 */
export function FilesPaneToggle({ count, unscannedRecordCount = 0 }: FilesPaneToggleProps) {
  const host = usePaneHost();
  const keys = useShortcutKeys("toggle_files");
  const open = host.isOpen("files");
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-keyshortcuts={keys.ariaKeyShortcuts}
      title={resourceCoverageNote(unscannedRecordCount)}
      onClick={() => host.togglePane("files")}
      className={`${pillStyles.outline} ${open ? "bg-surface-0 text-primary" : ""}`}
    >
      <FilesIcon className="h-3.5 w-3.5" aria-hidden="true" />
      Files {formatResourceCount(count, unscannedRecordCount)}
    </button>
  );
}
