import { Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, EllipsisVertical, FileDiff, List } from "lucide-react";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { useShortcut, useShortcutKeys } from "../../hooks/use-shortcut";
import {
  type SessionDiffFile,
  type SessionDiffResponse,
  type SessionDiffScopesResponse,
  formatDiffScope,
  parseDiffScope,
  sessionDiffFileQueryOptions,
  sessionDiffQueryOptions,
  sessionDiffScopesQueryOptions,
} from "../../lib/api/session-diff";
import { writeClipboardText } from "../../lib/clipboard";
import { loadChangesScope, saveChangesScope } from "../../lib/pane-layout";
import { type PaneChrome, registerPane } from "../panes/pane-registry";
import { type Settings, useSettings } from "../settings-provider";
import { usePaneHost } from "../panes/tile-host";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { useToast } from "../toast";
import { Tooltip } from "../ui/tooltip";
import { ChangedFilesSidebar } from "./changes-file-tree";
import { DiffFile, DiffFileHeader } from "./diff-file";
import { GoToFile } from "./go-to-file";

/**
 * Large-diff thresholds. Upstream collapses every file of a large diff but its
 * threshold was not decoded, so these are local picks: more than 100 files or
 * more than 10,000 changed lines (additions + deletions) counts as large.
 */
export const LARGE_DIFF_MAX_FILES = 100;
export const LARGE_DIFF_MAX_LINES = 10_000;

/** Upstream offers "Side by side" only when the pane is at least this wide. */
const SIDE_BY_SIDE_MIN_WIDTH = 560;

const TOO_LARGE_TO_EXPAND = "This diff is too large to expand at once. Select a file to expand it.";

const GHOST_ICON_BUTTON =
  "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary aria-pressed:bg-fill-control aria-pressed:text-primary";

export function isLargeDiff(files: readonly SessionDiffFile[]): boolean {
  if (files.length > LARGE_DIFF_MAX_FILES) return true;
  const lines = files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  return lines > LARGE_DIFF_MAX_LINES;
}

type ScopeLabel = { kind: "range"; base: string; head: string } | { kind: "text"; text: string };

type SessionDiffCommit = Extract<SessionDiffScopesResponse, { kind: "git" }>["commits"][number];

const BRANCH_SCOPE = "branch";
const NO_MESSAGE = "(no message)";

function commitShaOf(scope: string): string | null {
  const parsed = parseDiffScope(scope);
  return parsed?.kind === "commit" ? parsed.sha : null;
}

function commitScope(sha: string): string {
  return formatDiffScope({ kind: "commit", sha });
}

function commitMatches(commit: SessionDiffCommit, sha: string): boolean {
  return commit.sha.startsWith(sha) || sha.startsWith(commit.sha);
}

function scopeLabelOf(
  scope: string,
  diff: SessionDiffResponse | undefined,
  scopes: SessionDiffScopesResponse | undefined,
): ScopeLabel | null {
  if (diff?.source === "session-edits" || scopes?.kind === "no-git" || scope === "session") {
    return { kind: "text", text: "Session edits" };
  }
  if (scopes?.kind !== "git") return null;
  if (scope === "uncommitted") return { kind: "text", text: "Uncommitted changes" };
  const sha = commitShaOf(scope);
  if (sha !== null) {
    const commit = scopes.commits.find((candidate) => commitMatches(candidate, sha));
    return { kind: "text", text: commit ? commit.subject || commit.shortSha : sha.slice(0, 7) };
  }
  return { kind: "range", base: scopes.base, head: scopes.head ?? "working tree" };
}

function scopeLabelText(label: ScopeLabel): string {
  return label.kind === "range" ? `${label.base} → ${label.head}` : label.text;
}

function commitMatchesSearch(commit: SessionDiffCommit, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  return commit.subject.toLowerCase().includes(needle) || commit.sha.startsWith(needle);
}

function CommitsSubmenu({
  commits,
  totalCommits,
  selectedSha,
  onSelectScope,
}: {
  commits: readonly SessionDiffCommit[];
  totalCommits: number;
  selectedSha: string | null;
  onSelectScope: (scope: string) => void;
}) {
  const [search, setSearch] = useState("");
  const shown = commits.filter((commit) => commitMatchesSearch(commit, search));
  const older = totalCommits - commits.length;
  const selected = commits.find(
    (commit) => selectedSha !== null && commitMatches(commit, selectedSha),
  );
  return (
    <MenuSub>
      <MenuSubTrigger value={<span className="tabular-nums">{totalCommits}</span>}>
        Commits
      </MenuSubTrigger>
      <MenuSubContent>
        <div className="px-1 pb-1">
          <input
            type="text"
            aria-label="Search commits"
            placeholder="Search commits"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" && event.key !== "ArrowDown" && event.key !== "ArrowUp") {
                event.stopPropagation();
              }
            }}
            className="h-7 w-full min-w-[200px] rounded-r6 border border-border bg-transparent px-2 text-body text-primary outline-none placeholder:text-ink-muted focus:border-accent-100"
          />
        </div>
        {shown.length === 0 ? (
          <p className="px-2.5 py-1.5 text-body text-ink-muted">No commits match</p>
        ) : (
          <MenuRadioGroup
            value={selected?.sha ?? ""}
            onValueChange={(sha: unknown) => {
              if (typeof sha === "string") onSelectScope(commitScope(sha));
            }}
          >
            {shown.map((commit) => (
              <MenuRadioItem key={commit.sha} value={commit.sha} closeOnClick>
                <span className="flex min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{commit.subject || NO_MESSAGE}</span>
                  <span className="shrink-0 font-mono text-footnote text-ink-muted">
                    {commit.shortSha}
                  </span>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        )}
        {older > 0 && (
          <MenuItem disabled>
            {older === 1 ? "1 older commit not shown" : `${older} older commits not shown`}
          </MenuItem>
        )}
      </MenuSubContent>
    </MenuSub>
  );
}

function ScopeButton({
  label,
  scope,
  scopes,
  onSelectScope,
}: {
  label: ScopeLabel;
  scope: string;
  scopes: SessionDiffScopesResponse | undefined;
  onSelectScope: (scope: string) => void;
}) {
  const git = scopes?.kind === "git" ? scopes : null;
  const commitSha = commitShaOf(scope);
  const radioValue = commitSha === null ? scope : "commit";
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
        <MenuRadioGroup
          value={git === null ? "session" : radioValue}
          onValueChange={(value: unknown) => {
            if (typeof value === "string") onSelectScope(value);
          }}
        >
          {git && (
            <MenuRadioItem value={BRANCH_SCOPE} closeOnClick>
              <span className="flex min-w-0 items-center justify-between gap-3">
                <span>All changes</span>
                <span className="max-w-[160px] shrink-0 truncate text-footnote text-ink-muted">
                  vs {git.base}
                </span>
              </span>
            </MenuRadioItem>
          )}
          {git?.uncommittedAvailable && (
            <MenuRadioItem value="uncommitted" closeOnClick>
              Uncommitted changes
            </MenuRadioItem>
          )}
          <MenuRadioItem value="session" closeOnClick>
            Session edits
          </MenuRadioItem>
        </MenuRadioGroup>
        {git && git.commits.length > 0 && (
          <>
            <MenuSeparator />
            <CommitsSubmenu
              commits={git.commits}
              totalCommits={git.totalCommits}
              selectedSha={commitSha}
              onSelectScope={onSelectScope}
            />
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

type DiffPrefKey =
  | "diffShowTree"
  | "diffGroupByFolder"
  | "diffGroupByKind"
  | "diffWordWrap"
  | "diffWordDiff"
  | "diffHideWhitespace";

function PrefCheckboxItem({
  prefKey,
  shortcut,
  children,
}: {
  prefKey: DiffPrefKey;
  shortcut?: string;
  children: ReactNode;
}) {
  const { settings, setSetting } = useSettings();
  return (
    <MenuCheckboxItem
      checked={settings[prefKey]}
      onCheckedChange={(checked) => setSetting(prefKey, checked)}
      {...(shortcut === undefined ? {} : { shortcut })}
    >
      {children}
    </MenuCheckboxItem>
  );
}

/**
 * Upstream's Changes settings ⋯ menu. Checkbox items keep the menu open and
 * persist through app settings; an empty diff offers only Refresh.
 */
function SettingsMenu({
  hasFiles,
  large,
  sideBySideAvailable,
  onCollapseAll,
  onExpandAll,
  onRefresh,
}: {
  hasFiles: boolean;
  large: boolean;
  sideBySideAvailable: boolean;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onRefresh: () => void;
}) {
  const { settings, setSetting } = useSettings();
  const showFilesKeys = useShortcutKeys("toggle_changes_file_list");
  return (
    <Menu>
      <MenuTrigger aria-label="Changes settings" className={GHOST_ICON_BUTTON}>
        <EllipsisVertical aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuContent align="end">
        {hasFiles && (
          <>
            <PrefCheckboxItem prefKey="diffShowTree" shortcut={showFilesKeys.keys}>
              Show files
            </PrefCheckboxItem>
            <PrefCheckboxItem prefKey="diffGroupByFolder">Group files by folder</PrefCheckboxItem>
            <PrefCheckboxItem prefKey="diffGroupByKind">
              Separate test, build, and generated files
            </PrefCheckboxItem>
            <MenuSeparator />
            <MenuItem onSelect={onCollapseAll}>Collapse all files</MenuItem>
            {large ? (
              <Tooltip content={TOO_LARGE_TO_EXPAND} className="w-full">
                <MenuItem disabled>Expand all files</MenuItem>
              </Tooltip>
            ) : (
              <MenuItem onSelect={onExpandAll}>Expand all files</MenuItem>
            )}
            <MenuSeparator />
            {sideBySideAvailable && (
              <MenuCheckboxItem
                checked={settings.diffStyle === "split"}
                onCheckedChange={(checked) =>
                  setSetting("diffStyle", checked ? "split" : "unified")
                }
              >
                Side by side
              </MenuCheckboxItem>
            )}
            <PrefCheckboxItem prefKey="diffWordWrap">Word wrap</PrefCheckboxItem>
            <PrefCheckboxItem prefKey="diffWordDiff">Highlight changed words</PrefCheckboxItem>
            <PrefCheckboxItem prefKey="diffHideWhitespace">
              Hide whitespace changes
            </PrefCheckboxItem>
            <MenuSeparator />
          </>
        )}
        <MenuItem onSelect={onRefresh}>Refresh</MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** The element's content width, tracked with a ResizeObserver (0 until first measured). */
function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** How each file of the diff renders, from the Changes settings menu. */
interface DiffViewOptions {
  diffStyle: Settings["diffStyle"];
  wordWrap: boolean;
  wordDiff: boolean;
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

export interface DiffFetchContext {
  sessionId: string;
  scope: string;
  hideWhitespace?: boolean;
}

function LazyDiffFile({
  file,
  fetchContext,
  view,
  collapsed,
  onCollapsedChange,
  onOpenFile,
}: {
  file: SessionDiffFile;
  fetchContext: DiffFetchContext;
  view: DiffViewOptions;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpenFile: (() => void) | undefined;
}) {
  const query = useQuery({
    ...sessionDiffFileQueryOptions(fetchContext.sessionId, fetchContext.scope, file.path, {
      hideWhitespace: fetchContext.hideWhitespace === true,
    }),
    enabled: !collapsed,
  });
  const patch = query.data?.file.patch;
  if (!collapsed && patch) {
    return (
      <DiffFile
        patch={patch}
        {...view}
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
  view,
  collapsed,
  onCollapsedChange,
  onOpenFile,
  fetchContext,
}: {
  file: SessionDiffFile;
  view: DiffViewOptions;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpenFile: (() => void) | undefined;
  fetchContext: DiffFetchContext | undefined;
}) {
  if (file.patch !== null && !file.binary) {
    return (
      <DiffFile
        patch={file.patch}
        {...view}
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
        view={view}
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

/**
 * The file whose header is pinned at (or last scrolled past) the top of the diff scroller —
 * sticky headers of earlier files have scrolled away with their file.
 */
function fileInView(scroller: EventTarget): string | null {
  if (!(scroller instanceof HTMLElement)) return null;
  const top = scroller.getBoundingClientRect().top;
  let inView: string | null = null;
  for (const header of scroller.querySelectorAll<HTMLElement>("[data-diff-file-header]")) {
    if (header.getBoundingClientRect().top > top + 1) break;
    inView = header.dataset["diffFileHeader"] ?? inView;
  }
  return inView;
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
  onRefresh: () => void;
  onOpenFile?: (path: string) => void;
  /** Enables lazy loading of files whose patch was too large to inline. */
  fetchContext?: DiffFetchContext;
  /** The selected scope, a formatted `SessionDiffScope` (`branch`, `uncommitted`, `session`, `commit:<sha>`). */
  scope?: string;
  onSelectScope?: (scope: string) => void;
  onCopyCommitSha?: (sha: string) => void;
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
  onRefresh,
  onOpenFile,
  fetchContext,
  scope = BRANCH_SCOPE,
  onSelectScope = () => {},
  onCopyCommitSha = () => {},
}: ChangesPaneViewProps) {
  const files = diff?.files ?? [];
  const hasFiles = files.length > 0;
  const large = isLargeDiff(files);
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const { settings, setSetting } = useSettings();
  const showFiles = settings.diffShowTree;
  useShortcut("toggle_changes_file_list", () => setSetting("diffShowTree", !showFiles));
  const headerRef = useRef<HTMLDivElement>(null);
  const sideBySideAvailable = useElementWidth(headerRef) >= SIDE_BY_SIDE_MIN_WIDTH;
  const view: DiffViewOptions = {
    diffStyle: sideBySideAvailable ? settings.diffStyle : "unified",
    wordWrap: settings.diffWordWrap,
    wordDiff: settings.diffWordDiff,
  };
  const [activePath, setActivePath] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scopeLabel = scopeLabelOf(scope, diff, scopes);
  const selectedCommitSha = commitShaOf(scope);
  const unavailableCount = files.filter(isUnavailable).length;

  useEffect(() => {
    setCollapsedOverrides({});
  }, [diff]);

  const isCollapsed = (path: string) => collapsedOverrides[path] ?? large;
  const setAllCollapsed = (collapsed: boolean) =>
    setCollapsedOverrides(Object.fromEntries(files.map((file) => [file.path, collapsed])));

  function selectFile(path: string) {
    setActivePath(path);
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
        {showFiles && (
          <ChangedFilesSidebar
            files={files}
            groupByFolder={settings.diffGroupByFolder}
            groupByKind={settings.diffGroupByKind}
            activePath={activePath}
            onSelectFile={selectFile}
            {...(onOpenFile ? { onOpenFile } : {})}
            commits={scopes?.kind === "git" ? scopes.commits : []}
            selectedCommitSha={selectedCommitSha}
            onSelectCommit={(sha) => onSelectScope(sha === null ? BRANCH_SCOPE : commitScope(sha))}
            onCopyCommitSha={onCopyCommitSha}
          />
        )}
        <div
          ref={bodyRef}
          onScrollCapture={(event) => {
            const inView = fileInView(event.target);
            if (inView !== null) setActivePath(inView);
          }}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
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
                view={view}
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
      <div
        ref={headerRef}
        className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-1"
      >
        <div className="relative z-[1] flex min-w-0 items-center gap-1 pl-1">
          {hasFiles && (
            <ShowFilesToggle
              pressed={showFiles}
              onToggle={() => setSetting("diffShowTree", !showFiles)}
            />
          )}
          {scopeLabel && (
            <ScopeButton
              label={scopeLabel}
              scope={scope}
              scopes={scopes}
              onSelectScope={onSelectScope}
            />
          )}
        </div>
        {moveHandle}
        <div className="relative z-[1] flex shrink-0 items-center gap-0.5">
          {hasFiles && <GoToFile files={files} onSelectFile={selectFile} />}
          <SettingsMenu
            hasFiles={hasFiles}
            large={large}
            sideBySideAvailable={sideBySideAvailable}
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

function usePersistedScope(sessionId: string): [string, (scope: string) => void] {
  const [entry, setEntry] = useState(() => ({ sessionId, scope: loadChangesScope(sessionId) }));
  const current = entry.sessionId === sessionId ? entry.scope : loadChangesScope(sessionId);
  const setScope = useCallback(
    (scope: string) => {
      setEntry({ sessionId, scope });
      saveChangesScope(sessionId, scope);
    },
    [sessionId],
  );
  return [current, setScope];
}

/** The Changes pane for one session, showing the scope persisted for it (All changes by default). */
export function ChangesPane({ sessionId, chrome }: { sessionId: string; chrome: PaneChrome }) {
  const [scope, setScope] = usePersistedScope(sessionId);
  const hideWhitespace = useSettings().settings.diffHideWhitespace;
  const diffQuery = useQuery(sessionDiffQueryOptions(sessionId, scope, { hideWhitespace }));
  const scopesQuery = useQuery(sessionDiffScopesQueryOptions(sessionId));
  const toast = useToast();
  const message = diffQuery.error ? `Couldn't load changes: ${diffQuery.error.message}` : undefined;
  const scopes = scopesQuery.data;
  const selectedCommitSha = commitShaOf(scope);
  const commitVanished =
    selectedCommitSha !== null &&
    scopes !== undefined &&
    !(
      scopes.kind === "git" &&
      scopes.commits.some((commit) => commitMatches(commit, selectedCommitSha))
    );

  useEffect(() => {
    if (commitVanished) setScope(BRANCH_SCOPE);
  }, [commitVanished, setScope]);

  async function copyCommitSha(sha: string): Promise<void> {
    const copied = await writeClipboardText(sha);
    toast(
      copied
        ? { kind: "success", message: "Commit SHA copied to clipboard." }
        : { kind: "error", message: "Couldn’t copy the commit SHA. Try again." },
    );
  }

  return (
    <ChangesPaneView
      diff={diffQuery.data}
      scopes={scopes}
      {...(message === undefined ? {} : { message })}
      controls={chrome.controls}
      moveHandle={chrome.moveHandle}
      onRefresh={() => {
        void diffQuery.refetch();
        void scopesQuery.refetch();
      }}
      fetchContext={{ sessionId, scope: diffQuery.data?.scope ?? scope, hideWhitespace }}
      scope={scope}
      onSelectScope={setScope}
      onCopyCommitSha={(sha) => void copyCommitSha(sha)}
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
  useShortcut("toggle_changes", () => host.togglePane("changes"));
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
