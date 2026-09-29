import { Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, EllipsisVertical, FileDiff, List } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useShortcutKeys } from "../../hooks/use-shortcut";
import {
  type SessionDiffFile,
  type SessionDiffResponse,
  type SessionDiffScopesResponse,
  sessionDiffFileQueryOptions,
  sessionDiffQueryOptions,
  sessionDiffScopesQueryOptions,
} from "../../lib/api/session-diff";
import { type PaneChrome, registerPane } from "../panes/pane-registry";
import { usePaneHost } from "../panes/tile-host";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { DiffFile, DiffFileHeader } from "./diff-file";

/**
 * Large-diff thresholds. Upstream collapses every file of a large diff but its
 * threshold was not decoded, so these are local picks: more than 100 files or
 * more than 10,000 changed lines (additions + deletions) counts as large.
 */
export const LARGE_DIFF_MAX_FILES = 100;
export const LARGE_DIFF_MAX_LINES = 10_000;

const TOO_LARGE_TO_EXPAND = "This diff is too large to expand at once. Select a file to expand it.";

const GHOST_ICON_BUTTON =
  "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary aria-pressed:bg-fill-control aria-pressed:text-primary";

export function isLargeDiff(files: readonly SessionDiffFile[]): boolean {
  if (files.length > LARGE_DIFF_MAX_FILES) return true;
  const lines = files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  return lines > LARGE_DIFF_MAX_LINES;
}

type ScopeLabel = { kind: "range"; base: string; head: string } | { kind: "text"; text: string };

function scopeLabelOf(
  diff: SessionDiffResponse | undefined,
  scopes: SessionDiffScopesResponse | undefined,
): ScopeLabel | null {
  if (diff?.source === "session-edits" || scopes?.kind === "no-git") {
    return { kind: "text", text: "Session edits" };
  }
  if (scopes?.kind === "git") {
    return { kind: "range", base: scopes.base, head: scopes.head ?? "working tree" };
  }
  return null;
}

function scopeLabelText(label: ScopeLabel): string {
  return label.kind === "range" ? `${label.base} → ${label.head}` : label.text;
}

function ScopeButton({ label }: { label: ScopeLabel }) {
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Diff scope: ${scopeLabelText(label)}`}
        className="flex h-6 min-w-0 shrink cursor-pointer items-center rounded-r5 px-2 text-body text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary"
      >
        <span className="inline-flex min-w-0 items-center gap-1">
          {label.kind === "range" ? (
            <span className="grid min-w-0 grid-cols-[minmax(0,max-content)_auto_minmax(0,max-content)] items-center gap-1">
              <span className="min-w-0 truncate">{label.base}</span>
              <ArrowRight role="img" aria-label="to" className="size-3 text-ink-muted" />
              <span className="min-w-0 truncate">{label.head}</span>
            </span>
          ) : (
            <span className="min-w-0 truncate">{label.text}</span>
          )}
          <ChevronDown aria-hidden="true" className="size-3 shrink-0 opacity-60" />
        </span>
      </MenuTrigger>
      <MenuContent>
        <MenuRadioGroup value={label.kind === "range" ? "branch" : "session"}>
          {label.kind === "range" ? (
            <MenuRadioItem value="branch">
              <span className="flex min-w-0 items-center justify-between gap-3">
                <span>All changes</span>
                <span className="max-w-[160px] shrink-0 truncate text-footnote text-ink-muted">
                  vs {label.base}
                </span>
              </span>
            </MenuRadioItem>
          ) : (
            <MenuRadioItem value="session">Session edits</MenuRadioItem>
          )}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function SettingsMenu({
  hasFiles,
  large,
  onCollapseAll,
  onExpandAll,
  onRefresh,
}: {
  hasFiles: boolean;
  large: boolean;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onRefresh: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger aria-label="Changes settings" className={GHOST_ICON_BUTTON}>
        <EllipsisVertical aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuContent align="end">
        {hasFiles && (
          <>
            <MenuItem onSelect={onCollapseAll}>Collapse all files</MenuItem>
            {large ? (
              <Tooltip content={TOO_LARGE_TO_EXPAND} className="w-full">
                <MenuItem disabled>Expand all files</MenuItem>
              </Tooltip>
            ) : (
              <MenuItem onSelect={onExpandAll}>Expand all files</MenuItem>
            )}
            <MenuSeparator />
          </>
        )}
        <MenuItem onSelect={onRefresh}>Refresh</MenuItem>
      </MenuContent>
    </Menu>
  );
}

function ShowFilesToggle({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  const keys = useShortcutKeys("toggle_changes_file_list");
  const label = pressed ? "Hide files" : "Show files";
  return (
    <Tooltip content={label} shortcut={keys.keys}>
      <button
        type="button"
        aria-pressed={pressed}
        aria-label={label}
        aria-keyshortcuts={keys.ariaKeyShortcuts}
        onClick={onToggle}
        className={GHOST_ICON_BUTTON}
      >
        <List aria-hidden="true" className="size-4" />
      </button>
    </Tooltip>
  );
}

function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1
    ? { name: path, dir: "" }
    : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}

/** Flat list of changed files; the folder tree replaces it later. */
function FileList({
  files,
  onSelect,
}: {
  files: readonly SessionDiffFile[];
  onSelect: (path: string) => void;
}) {
  return (
    <div className="w-60 shrink-0 overflow-y-auto border-r border-border px-1 py-1">
      <div role="list" aria-label="Changed files" className="flex flex-col">
        {files.map((file) => {
          const { name, dir } = splitPath(file.path);
          return (
            <button
              key={file.path}
              type="button"
              role="listitem"
              title={file.path}
              onClick={() => onSelect(file.path)}
              className="flex h-6 w-full cursor-pointer items-center gap-1 rounded-r5 px-2 text-left text-body text-primary hover:bg-fill-ghost-hover"
            >
              <span className="flex min-w-0 flex-1 items-baseline gap-1">
                <span className="shrink-0 truncate">{name}</span>
                {dir && (
                  <span className="min-w-0 truncate text-footnote text-ink-muted">{dir}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-0.5 text-footnote tabular-nums">
                <span className="text-extended-green">+{file.additions}</span>
                <span className="text-extended-pink">−{file.deletions}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface DiffFetchContext {
  sessionId: string;
  scope: string;
}

function LazyDiffFile({
  file,
  fetchContext,
  collapsed,
  onCollapsedChange,
  onOpenFile,
}: {
  file: SessionDiffFile;
  fetchContext: DiffFetchContext;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpenFile: (() => void) | undefined;
}) {
  const query = useQuery({
    ...sessionDiffFileQueryOptions(fetchContext.sessionId, fetchContext.scope, file.path),
    enabled: !collapsed,
  });
  const patch = query.data?.file.patch;
  if (!collapsed && patch) {
    return (
      <DiffFile
        patch={patch}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        {...(onOpenFile ? { onOpenFile } : {})}
      />
    );
  }
  return (
    <div>
      <DiffFileHeader
        path={file.path}
        prevPath={file.oldPath}
        additions={file.additions}
        deletions={file.deletions}
        collapsed={collapsed}
        onToggle={() => onCollapsedChange(!collapsed)}
        onOpenFile={onOpenFile}
      />
      {!collapsed && (
        <p className="px-3 py-2 text-footnote text-ink-muted">
          {query.isError ? "Couldn't load this file's diff." : "Loading diff…"}
        </p>
      )}
    </div>
  );
}

function ChangesFile({
  file,
  collapsed,
  onCollapsedChange,
  onOpenFile,
  fetchContext,
}: {
  file: SessionDiffFile;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpenFile: (() => void) | undefined;
  fetchContext: DiffFetchContext | undefined;
}) {
  if (file.patch !== null && !file.binary) {
    return (
      <DiffFile
        patch={file.patch}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        {...(onOpenFile ? { onOpenFile } : {})}
      />
    );
  }
  if (!file.binary && fetchContext !== undefined) {
    return (
      <LazyDiffFile
        file={file}
        fetchContext={fetchContext}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        onOpenFile={onOpenFile}
      />
    );
  }
  return (
    <DiffFileHeader
      path={file.path}
      prevPath={file.oldPath}
      additions={file.additions}
      deletions={file.deletions}
      collapsed
      onToggle={() => {}}
      onOpenFile={onOpenFile}
    />
  );
}

function CenteredMessage({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 py-4 text-center">
      <p
        className={`max-w-[36ch] text-pretty break-words text-body ${muted ? "text-ink-muted" : "text-primary"}`}
      >
        {children}
      </p>
    </div>
  );
}

function isUnavailable(file: SessionDiffFile): boolean {
  return file.binary;
}

export interface ChangesPaneViewProps {
  /** Undefined while loading or after an error; `message` explains which. */
  diff: SessionDiffResponse | undefined;
  scopes: SessionDiffScopesResponse | undefined;
  message?: string;
  /** Host Expand/Close controls, placed at the right end of the header. */
  controls: ReactNode;
  moveHandle?: ReactNode;
  /** Go to file (⌘P) combobox; shown only when the diff has files. */
  goToFile?: ReactNode;
  onRefresh: () => void;
  onOpenFile?: (path: string) => void;
  /** Enables lazy loading of files whose patch was too large to inline. */
  fetchContext?: DiffFetchContext;
}

/**
 * claude.ai/code's Changes pane: a 32px header (Show files, diff scope, Move,
 * Go to file, settings, Expand, Close) over one `@pierre/diffs` file per
 * changed path inside the library's virtualizer, with sticky collapsible file
 * headers and the empty, unavailable and large-diff states.
 */
export function ChangesPaneView({
  diff,
  scopes,
  message,
  controls,
  moveHandle,
  goToFile,
  onRefresh,
  onOpenFile,
  fetchContext,
}: ChangesPaneViewProps) {
  const files = diff?.files ?? [];
  const hasFiles = files.length > 0;
  const large = isLargeDiff(files);
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [showFiles, setShowFiles] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scopeLabel = scopeLabelOf(diff, scopes);
  const unavailableCount = files.filter(isUnavailable).length;

  useEffect(() => {
    setCollapsedOverrides({});
  }, [diff]);

  const isCollapsed = (path: string) => collapsedOverrides[path] ?? large;
  const setAllCollapsed = (collapsed: boolean) =>
    setCollapsedOverrides(Object.fromEntries(files.map((file) => [file.path, collapsed])));

  function selectFile(path: string) {
    setCollapsedOverrides((previous) => ({ ...previous, [path]: false }));
    const header = bodyRef.current?.querySelector(`[data-diff-file-header="${CSS.escape(path)}"]`);
    header?.scrollIntoView({ block: "start" });
  }

  let body: ReactNode;
  if (diff === undefined) {
    body = <CenteredMessage muted>{message ?? "Loading changes…"}</CenteredMessage>;
  } else if (!hasFiles) {
    body = <CenteredMessage>No changes to show</CenteredMessage>;
  } else {
    body = (
      <div className="flex min-h-0 flex-1">
        {showFiles && <FileList files={files} onSelect={selectFile} />}
        <div ref={bodyRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
          {large && (
            <p className="shrink-0 border-b border-border px-3 py-1.5 text-footnote text-ink-muted">
              Files are collapsed for large diffs. Select a file to expand it.
            </p>
          )}
          <Virtualizer
            className="min-h-0 flex-1 overflow-y-auto text-primary [overflow-anchor:none]"
            contentClassName="flex flex-col pb-2"
          >
            {files.map((file) => (
              <ChangesFile
                key={file.path}
                file={file}
                collapsed={isCollapsed(file.path)}
                onCollapsedChange={(collapsed) =>
                  setCollapsedOverrides((previous) => ({ ...previous, [file.path]: collapsed }))
                }
                onOpenFile={onOpenFile ? () => onOpenFile(file.path) : undefined}
                fetchContext={fetchContext}
              />
            ))}
            {unavailableCount > 0 && (
              <p className="px-3 py-4 text-center text-body text-ink-muted">
                Diff content unavailable for {unavailableCount}{" "}
                {unavailableCount === 1 ? "file" : "files"}.
              </p>
            )}
          </Virtualizer>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-1">
        <div className="relative z-[1] flex min-w-0 items-center gap-1 pl-1">
          {hasFiles && (
            <ShowFilesToggle pressed={showFiles} onToggle={() => setShowFiles((value) => !value)} />
          )}
          {scopeLabel && <ScopeButton label={scopeLabel} />}
        </div>
        {moveHandle}
        <div className="relative z-[1] flex shrink-0 items-center gap-0.5">
          {hasFiles && goToFile}
          <SettingsMenu
            hasFiles={hasFiles}
            large={large}
            onCollapseAll={() => setAllCollapsed(true)}
            onExpandAll={() => setAllCollapsed(false)}
            onRefresh={onRefresh}
          />
          {controls}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[inherit]">{body}</div>
    </>
  );
}

const BRANCH_SCOPE = "branch";

/** The Changes pane for one session, showing the branch scope (base → working tree). */
function ChangesPane({ sessionId, chrome }: { sessionId: string; chrome: PaneChrome }) {
  const diffQuery = useQuery(sessionDiffQueryOptions(sessionId, BRANCH_SCOPE));
  const scopesQuery = useQuery(sessionDiffScopesQueryOptions(sessionId));
  const message = diffQuery.error ? `Couldn't load changes: ${diffQuery.error.message}` : undefined;
  return (
    <ChangesPaneView
      diff={diffQuery.data}
      scopes={scopesQuery.data}
      {...(message === undefined ? {} : { message })}
      controls={chrome.controls}
      moveHandle={chrome.moveHandle}
      onRefresh={() => {
        void diffQuery.refetch();
        void scopesQuery.refetch();
      }}
      fetchContext={{ sessionId, scope: diffQuery.data?.scope ?? BRANCH_SCOPE }}
    />
  );
}

/** Registers the `changes` pane kind for this session while mounted. */
export function useRegisterChangesPane(sessionId: string): void {
  useEffect(
    () =>
      registerPane("changes", {
        title: "Changes",
        header: "custom",
        render: (chrome) => <ChangesPane sessionId={sessionId} chrome={chrome} />,
      }),
    [sessionId],
  );
}

/** Titlebar toggle for the Changes pane: "Changes ⌃⇧D", pressed while the pane is open. */
export function ChangesPaneToggle() {
  const host = usePaneHost();
  const keys = useShortcutKeys("toggle_changes");
  const open = host.isOpen("changes");
  return (
    <Tooltip content="Changes" shortcut={keys.keys}>
      <button
        type="button"
        aria-label="Changes"
        aria-pressed={open}
        aria-keyshortcuts={keys.ariaKeyShortcuts}
        onClick={() => host.togglePane("changes")}
        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-primary aria-pressed:bg-accent-900 aria-pressed:text-accent-100"
      >
        <FileDiff aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  );
}
