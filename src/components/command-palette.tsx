import { Dialog } from "@base-ui/react/dialog";
import { Command, defaultFilter } from "cmdk";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Brain,
  MessageSquare,
  FolderOpen,
  Search,
  Star,
  Home,
  SlidersHorizontal,
  CircleCheckBig,
  Keyboard,
  CornerDownLeft,
  X,
  PanelLeft,
  ListChecks,
  Activity,
  Puzzle,
  File,
  LoaderCircle,
  ListFilter,
} from "lucide-react";
import type { PaletteMode } from "../hooks/use-command-palette";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { encodeFilePath } from "../lib/api/file";
import { projectsQueryOptions } from "../lib/api/projects";
import { unifiedSearchQueryOptions, type UnifiedSearchItem } from "../lib/api/search";
import { recentSessionsQueryOptions, type SessionListItem } from "../lib/api/sessions";
import {
  PALETTE_FILTER_TOKENS,
  PaletteTypeSchema,
  paletteDateCutoff,
  paletteFilterHints,
  paletteProjectMatches,
  paletteSearchParams,
  parsePaletteTokens,
  withoutTypeTokens,
  type PaletteFilter,
  type PaletteProject,
  type PaletteTokens,
  type PaletteType,
} from "../lib/palette-tokens";
import { paletteFilterLabels, paletteTypeLabels } from "../lib/schema-choices";
import { relativeBucket, titleMatches, type Snippet, type TextMatch } from "../lib/search-text";
import type { SessionBucket } from "../lib/session-state";
import { SHORTCUTS, type ShortcutId } from "../lib/shortcuts/registry";
import { toggleSidebarCollapsed } from "../lib/sidebar-store";
import { type ShortcutKeys, useShortcutKeys } from "../hooks/use-shortcut";
import { clearAll } from "../lib/unread-store";
import { HighlightRuns } from "./highlight-runs";
import {
  type PaletteCardSession,
  PaletteRowActionsButton,
  PaletteRowActionsCard,
} from "./palette-row-actions";
import { Shortcut } from "./ui/shortcut";
import { useOpenSettings } from "./settings/settings-dialog";
import { setKeyboardShortcutsOpen } from "./keyboard-shortcuts-dialog";

/*
 * The claude.ai/code ⌘K palette shell, split Search | Compose variant
 * (see .llm/upstream-sync/features/search-or-start.md). cmdk keeps the list
 * filtering and keyboard selection; the dialog, input row, headings, rows and
 * footer copy upstream's geometry.
 */

const MODE_LABELS = {
  search: "Search",
  compose: "Write a message…",
} as const satisfies Record<PaletteMode, string>;

const PALETTE_RADIUS = "rounded-[calc(var(--radius-composer)+0.375rem)]";

const GROUP_CLASS =
  "[&_[cmdk-group-heading]]:px-3.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-ink-muted [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-col [&_[cmdk-group-items]]:gap-1";

/** Fetched deep enough that sessions needing attention surface even when they are not the newest. */
export const PALETTE_RECENT_LIMIT = 25;

/** Upstream caps the default entrypoint's organic list (Needs attention + Recents) at 7. */
const ORGANIC_LIMIT = 7;

const SEARCH_DEBOUNCE_MS = 150;
const SKELETON_ROWS = 3;

/** Server hit kinds plus projects, which the Projects tab lists client-side. */
type SearchKind = UnifiedSearchItem["kind"] | "project";

const KIND_ICONS = {
  session: <MessageSquare />,
  plan: <FileText />,
  memory: <Brain />,
  file: <File />,
  project: <FolderOpen />,
} as const satisfies Record<SearchKind, ReactNode>;

/** One typed-search row: an instant title match over recents, or a server hit. */
interface SearchRow {
  kind: SearchKind;
  id: string;
  title: string;
  titleMatches: readonly TextMatch[];
  snippet: Snippet | undefined;
  mtime: string;
  awaiting: boolean;
  href: string | undefined;
}

function sessionRow(session: SessionListItem, matches: readonly TextMatch[]): SearchRow {
  return {
    kind: "session",
    id: session.id,
    title: session.title,
    titleMatches: matches,
    snippet: undefined,
    mtime: session.mtime,
    awaiting: session.bucket === "blocked",
    href: undefined,
  };
}

function instantRows(sessions: readonly SessionListItem[], query: string): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const session of sessions) {
    const matches = titleMatches(session.title, query);
    if (matches !== null) rows.push(sessionRow(session, matches));
  }
  return rows;
}

/** Apply the `repo:`/`project:` and `date:` tokens to cached recents, like the server does to hits. */
function filterSessions(
  sessions: readonly SessionListItem[],
  tokens: PaletteTokens,
  projects: readonly PaletteProject[],
  now: number,
): SessionListItem[] {
  const { project, date } = tokens;
  const cutoff = date === undefined ? null : paletteDateCutoff(date, now);
  const resolved =
    project === undefined ? undefined : projects.find((p) => paletteProjectMatches(project, p));
  return sessions.filter((session) => {
    if (cutoff !== null && Date.parse(session.mtime) < cutoff) return false;
    if (project === undefined) return true;
    if (resolved !== undefined) {
      return session.projectName === resolved.name || session.project === resolved.projectPath;
    }
    return paletteProjectMatches(project, {
      id: "",
      name: session.projectName,
      projectPath: session.project,
    });
  });
}

function projectRows(projects: readonly PaletteProjectItem[], text: string): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const project of projects) {
    const matches = text === "" ? [] : titleMatches(project.name, text);
    if (matches === null) continue;
    rows.push({
      kind: "project",
      id: project.id,
      title: project.name,
      titleMatches: matches,
      snippet: undefined,
      mtime: project.lastActivity,
      awaiting: false,
      href: undefined,
    });
  }
  return rows;
}

interface PaletteProjectItem extends PaletteProject {
  lastActivity: string;
}

function serverRow(item: UnifiedSearchItem): SearchRow {
  return {
    kind: item.kind,
    id: item.id,
    title: item.title,
    titleMatches: item.titleMatches,
    snippet: item.snippet,
    mtime: item.mtime,
    awaiting: item.state === "waiting",
    href: item.href,
  };
}

const NO_PROJECTS: readonly PaletteProjectItem[] = [];

/** "/…" hint rows, or null to search normally (also when no hint matches). */
function hintsFor(query: string): PaletteFilter[] | null {
  const hints = paletteFilterHints(query);
  return hints === null || hints.length === 0 ? null : hints;
}

function rowKey(row: Pick<SearchRow, "kind" | "id">): string {
  return `${row.kind}:${row.id}`;
}

function commandMatches(label: string, query: string, keywords: readonly string[] = []): boolean {
  return defaultFilter(label, query, [...keywords]) > 0;
}

type AttentionBucket = Extract<SessionBucket, "blocked" | "review">;

const ATTENTION_LABELS = {
  blocked: "Awaiting input",
  review: "Needs review",
} as const satisfies Record<AttentionBucket, string>;

interface PaletteSession {
  id: string;
  title: string;
}

interface AttentionSession extends PaletteSession {
  bucket: AttentionBucket;
}

function isAttentionBucket(bucket: SessionBucket): bucket is AttentionBucket {
  return bucket === "blocked" || bucket === "review";
}

/** Split the recent feed into upstream's empty-state groups, dropping the session on screen. */
function paletteSessionGroups(
  sessions: readonly SessionListItem[],
  currentSessionId: string | undefined,
): { attention: AttentionSession[]; recents: PaletteSession[] } {
  const attention: AttentionSession[] = [];
  const recents: PaletteSession[] = [];
  for (const session of sessions) {
    if (session.id === currentSessionId) continue;
    if (isAttentionBucket(session.bucket)) {
      attention.push({ id: session.id, title: session.title, bucket: session.bucket });
    } else {
      recents.push({ id: session.id, title: session.title });
    }
  }
  const cappedAttention = attention.slice(0, ORGANIC_LIMIT);
  return {
    attention: cappedAttention,
    recents: recents.slice(0, ORGANIC_LIMIT - cappedAttention.length),
  };
}

/** Pages reachable by typing; upstream keeps navigation out of the empty state. */
const NAV_COMMANDS = [
  { to: "/", label: "Home", icon: <Home />, keywords: ["home", "start"] },
  { to: "/sessions", label: "Sessions", icon: <MessageSquare />, keywords: ["session", "history"] },
  { to: "/active", label: "Active", icon: <Activity />, keywords: ["active", "live", "running"] },
  { to: "/starred", label: "Starred", icon: <Star />, keywords: ["star", "pin", "favorite"] },
  { to: "/projects", label: "Projects", icon: <FolderOpen />, keywords: ["project", "repo"] },
  { to: "/plans", label: "Plans", icon: <FileText />, keywords: ["plan", "markdown"] },
  { to: "/memories", label: "Memories", icon: <Brain />, keywords: ["memory", "claude.md"] },
  { to: "/tasks", label: "Tasks", icon: <ListChecks />, keywords: ["task", "todo"] },
  { to: "/customize", label: "Customize", icon: <Puzzle />, keywords: ["skill", "plugin"] },
] as const;

interface PaletteAction {
  label: string;
  icon: ReactNode;
  run: () => void;
  shortcut?: ShortcutId;
}

function useCurrentSessionId(): string | undefined {
  return useRouterState({
    select: (state) => {
      for (const match of state.matches) {
        if (match.routeId === "/session/$id") return match.params.id;
      }
      return undefined;
    },
  });
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: PaletteMode;
  onModeChange?: (mode: PaletteMode) => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  mode: controlledMode,
  onModeChange,
}: CommandPaletteProps) {
  const [uncontrolledMode, setUncontrolledMode] = useState<PaletteMode>("search");
  const mode = controlledMode ?? uncontrolledMode;
  const setMode = onModeChange ?? setUncontrolledMode;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <PalettePopup mode={mode} onModeChange={setMode} onOpenChange={onOpenChange} />
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Mounted only while open, so the query resets on every open like upstream. */
function PalettePopup({
  mode,
  onModeChange,
  onOpenChange,
}: {
  mode: PaletteMode;
  onModeChange: (mode: PaletteMode) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const openSettings = useOpenSettings();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [rowActions, setRowActions] = useState<{ session: PaletteCardSession; top: number } | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PaletteType>("all");
  const [settledHeight, setSettledHeight] = useState<number | null>(null);
  const { data } = useQuery(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT));
  const currentSessionId = useCurrentSessionId();

  const { attention, recents } = useMemo(
    () => paletteSessionGroups(data?.sessions ?? [], currentSessionId),
    [data, currentSessionId],
  );

  const trimmedQuery = query.trim();
  const hints = hintsFor(trimmedQuery);
  const tokens = useMemo(() => parsePaletteTokens(trimmedQuery), [trimmedQuery]);
  const type = tokens.type ?? tab;
  const filtered = type !== "all" || tokens.project !== undefined || tokens.date !== undefined;
  const projectsQuery = useQuery({
    ...projectsQueryOptions(),
    enabled: type === "projects" || tokens.project !== undefined,
  });
  const projects = projectsQuery.data ?? NO_PROJECTS;
  const searchesSessions = hints === null && (type === "all" || type === "sessions");

  const debouncedQuery = useDebouncedValue(trimmedQuery, SEARCH_DEBOUNCE_MS);
  const debouncedParams =
    hintsFor(debouncedQuery) === null
      ? paletteSearchParams(parsePaletteTokens(debouncedQuery), tab, projects)
      : null;
  const serverActive =
    hints === null &&
    tokens.text !== "" &&
    type !== "projects" &&
    (tokens.project === undefined || !projectsQuery.isPending);
  const serverSearch = useQuery({
    ...unifiedSearchQueryOptions(debouncedParams ?? { query: "" }),
    enabled: serverActive && debouncedParams !== null && debouncedParams.query !== "",
  });
  const searching = serverActive && (debouncedQuery !== trimmedQuery || serverSearch.isFetching);

  const visibleSessions = useMemo(
    () =>
      filterSessions(
        (data?.sessions ?? []).filter((session) => session.id !== currentSessionId),
        tokens,
        projects,
        Date.now(),
      ),
    [data, currentSessionId, tokens, projects],
  );

  // Sessions with no text lists recents; Projects is searched client-side.
  const listing = useMemo((): SearchRow[] | null => {
    if (hints !== null || (trimmedQuery === "" && tab === "all")) return null;
    if (type === "projects") return projectRows(projects, tokens.text);
    if (type === "sessions" && tokens.text === "") {
      return visibleSessions
        .slice(0, PALETTE_RECENT_LIMIT)
        .map((session) => sessionRow(session, []));
    }
    return null;
  }, [hints, trimmedQuery, tab, type, projects, tokens.text, visibleSessions]);

  const instant = useMemo(
    () =>
      !searchesSessions || tokens.text === "" ? [] : instantRows(visibleSessions, tokens.text),
    [searchesSessions, visibleSessions, tokens.text],
  );

  // Instant rows keep their position; server rows append, minus what is already shown.
  const serverRows = useMemo(() => {
    if (!serverActive || debouncedQuery !== trimmedQuery || serverSearch.data === undefined) {
      return [];
    }
    const shown = new Set(instant.map(rowKey));
    return serverSearch.data.items
      .filter((item) => item.id !== currentSessionId || item.kind !== "session")
      .map(serverRow)
      .filter((row) => !shown.has(rowKey(row)));
  }, [serverActive, serverSearch.data, debouncedQuery, trimmedQuery, instant, currentSessionId]);

  // Sessions the → card can act on: recents carry star/bucket state, server hits do not.
  const cardSessions = useMemo(() => {
    const byId = new Map<string, PaletteCardSession>();
    for (const row of serverRows) {
      if (row.kind !== "session") continue;
      byId.set(row.id, {
        id: row.id,
        title: row.title,
        mtime: row.mtime,
        starred: undefined,
        bucket: undefined,
      });
    }
    for (const session of data?.sessions ?? []) {
      byId.set(session.id, {
        id: session.id,
        title: session.title,
        mtime: session.mtime,
        starred: session.starred,
        bucket: session.bucket,
      });
    }
    return byId;
  }, [data, serverRows]);

  function openRowActions(id: string) {
    const session = cardSessions.get(id);
    const popup = popupRef.current;
    if (session === undefined || popup === null) return;
    const row = [...popup.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
      (item) => item.dataset["value"] === `session:${id}`,
    );
    const top =
      row === undefined ? 0 : row.getBoundingClientRect().top - popup.getBoundingClientRect().top;
    setRowActions({ session, top });
  }

  function closeRowActions({ refocus }: { refocus: boolean }) {
    setRowActions(null);
    if (refocus) inputRef.current?.focus();
  }

  function openSession(id: string) {
    void navigate({ to: "/session/$id", params: { id } });
  }

  function openRow(row: SearchRow) {
    if (row.kind === "session") openSession(row.id);
    else if (row.kind === "project") void navigate({ to: "/project/$id", params: { id: row.id } });
    else if (row.kind === "file") {
      void navigate({ to: "/file/$", params: { _splat: encodeFilePath(row.id) } });
    } else if (row.href !== undefined) void navigate({ href: row.href });
  }

  function seeAllResults(apiType: Exclude<PaletteType, "projects">) {
    void navigate({ to: "/search", search: { q: tokens.text, mode: "titles", type: apiType } });
  }

  function chooseTab(next: PaletteType) {
    setTab(next);
    inputRef.current?.focus();
  }

  function chooseFilter(filter: PaletteFilter) {
    setQuery(PALETTE_FILTER_TOKENS[filter]);
    inputRef.current?.focus();
  }

  function searchAll() {
    setQuery(withoutTypeTokens(query));
    chooseTab("all");
  }

  // Upstream's Actions minus the cloud-only ones; "New session…" joins once herdr launch exists.
  const actions = (
    [
      {
        label: "Search sessions",
        icon: <Search />,
        run: () => void navigate({ to: "/search", search: { q: "", mode: "titles" as const } }),
        shortcut: "search",
      },
      {
        label: "Keyboard shortcuts",
        icon: <Keyboard />,
        run: () => setKeyboardShortcutsOpen(true),
        shortcut: "shortcuts_modal",
      },
      {
        label: "Toggle sidebar",
        icon: <PanelLeft />,
        run: toggleSidebarCollapsed,
        shortcut: "toggle_sidebar",
      },
      {
        label: "Settings",
        icon: <SlidersHorizontal />,
        run: () => openSettings("general"),
        shortcut: "settings",
      },
      { label: "Mark all sessions seen", icon: <CircleCheckBig />, run: clearAll },
    ] satisfies PaletteAction[]
  ).filter(
    (action: PaletteAction) => action.shortcut === undefined || SHORTCUTS[action.shortcut].enabled,
  );

  // Upstream centres the card on its first settled height so it does not jump while filtering.
  useLayoutEffect(() => {
    const height = cardRef.current?.offsetHeight ?? 0;
    if (settledHeight === null && height > 0) setSettledHeight(height);
  }, [settledHeight, attention.length, recents.length]);

  function select(callback: () => void) {
    onOpenChange(false);
    callback();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      openSelectedRowActions(event);
      return;
    }
    if (event.key !== "Tab" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onModeChange(mode === "search" ? "compose" : "search");
  }

  // → at the end of the input opens the row-actions card for the selected session row.
  function openSelectedRowActions(event: KeyboardEvent<HTMLDivElement>) {
    const input = inputRef.current;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (input === null || event.target !== input) return;
    if (input.selectionStart !== input.value.length || input.selectionEnd !== input.value.length) {
      return;
    }
    const selected = cardRef.current?.querySelector<HTMLElement>(
      '[cmdk-item][data-selected="true"]',
    )?.dataset["value"];
    if (selected?.startsWith("session:") !== true) return;
    const id = selected.slice("session:".length);
    if (!cardSessions.has(id)) return;
    event.preventDefault();
    openRowActions(id);
  }

  const compose = mode === "compose";
  const now = Date.now();
  const matchesCommands = hints === null && !filtered && tokens.text !== "";
  const matchedActions = matchesCommands
    ? actions.filter((action) => commandMatches(action.label, tokens.text))
    : [];
  const matchedCommands = matchesCommands
    ? NAV_COMMANDS.filter((command) => commandMatches(command.label, tokens.text, command.keywords))
    : [];
  const resultCount =
    (listing?.length ?? 0) +
    instant.length +
    matchedActions.length +
    matchedCommands.length +
    serverRows.length;
  const showEmptyState = !compose && trimmedQuery === "" && tab === "all";
  const showResults = !compose && hints === null && !showEmptyState;
  const label = MODE_LABELS[mode];

  return (
    <Dialog.Popup
      ref={popupRef}
      data-command-palette=""
      initialFocus={inputRef}
      className={`fixed left-1/2 z-50 w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 outline-none md:w-[calc(100vw-5rem)] ${PALETTE_RADIUS}`}
      style={{
        top: "max(1rem, min(25vh, calc((100vh - var(--cp-settled-h, 0px)) / 2)))",
        ...(settledHeight === null
          ? {}
          : ({ "--cp-settled-h": `${settledHeight}px` } as React.CSSProperties)),
      }}
    >
      <Dialog.Title className="sr-only">Search</Dialog.Title>
      <ModeSwitch mode={mode} onModeChange={onModeChange} />
      <div
        ref={cardRef}
        className={`relative overflow-hidden border-[0.5px] border-strong bg-surface-3 shadow-2xl transition-transform duration-150 ease-out motion-reduce:transition-none ${
          rowActions === null ? "" : "scale-[.97]"
        } ${PALETTE_RADIUS}`}
      >
        <div
          aria-hidden="true"
          data-palette-recede-veil=""
          className={`pointer-events-none absolute inset-0 z-10 bg-backdrop transition-opacity duration-150 ease-out ${
            rowActions === null ? "opacity-0" : "opacity-20"
          }`}
        />
        <Command
          label={label}
          loop
          shouldFilter={false}
          onKeyDown={handleKeyDown}
          className="flex flex-col"
        >
          <div
            className={`relative flex items-center gap-2 pt-[1.1rem] pr-2.5 pl-6 ${
              compose ? "flex-wrap pb-3" : "pb-[0.9rem]"
            }`}
          >
            {compose && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-1.5 rounded-composer bg-alpha-1 shadow-panel-sm"
              />
            )}
            <Command.Input asChild value={query} onValueChange={setQuery}>
              <textarea
                ref={inputRef}
                placeholder={label}
                rows={compose ? 2 : 1}
                wrap={compose ? undefined : "off"}
                className={`relative max-h-24 min-w-[5rem] flex-1 resize-none border-none bg-transparent py-1.5 text-sm leading-5 text-primary outline-none placeholder:text-ink-muted ${
                  compose ? "overflow-y-auto" : "overflow-x-auto overflow-y-hidden"
                }`}
              />
            </Command.Input>
            {!compose && searching && (
              <span
                role="img"
                aria-label="Searching deeper..."
                className="relative flex size-4 shrink-0 items-center justify-center text-ink-muted"
              >
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              </span>
            )}
            <Dialog.Close
              aria-label="Close"
              className="relative flex aspect-square h-7 w-7 shrink-0 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </Dialog.Close>
          </div>
          {!compose && <TypeTabs value={tab} onChange={chooseTab} />}
          <div className="h-[0.5px] w-full bg-border" />

          <Command.List className="max-h-[440px] overflow-y-auto p-2.5">
            {!compose && hints !== null && (
              <div role="group" aria-label="Filters" className="flex flex-col gap-1">
                {hints.map((filter) => (
                  <CommandItem
                    key={filter}
                    value={`filter:${filter}`}
                    icon={<ListFilter />}
                    onSelect={() => chooseFilter(filter)}
                  >
                    Filter by{" "}
                    <span className="ml-1 rounded bg-fill-ghost-hover px-1.5 py-px text-xs text-secondary">
                      {paletteFilterLabels[filter]}
                    </span>
                  </CommandItem>
                ))}
              </div>
            )}

            {showEmptyState && (
              <>
                {attention.length > 0 && (
                  <Command.Group heading="Needs attention" className={GROUP_CLASS}>
                    {attention.map((session) => (
                      <SessionRowActions key={session.id} onOpen={() => openRowActions(session.id)}>
                        <CommandItem
                          icon={<AttentionIcon />}
                          value={`session:${session.id}`}
                          onSelect={() => select(() => openSession(session.id))}
                          rowActions
                        >
                          {session.title}
                          <span className="sr-only"> {ATTENTION_LABELS[session.bucket]}</span>
                        </CommandItem>
                      </SessionRowActions>
                    ))}
                  </Command.Group>
                )}

                {recents.length > 0 && (
                  <Command.Group heading="Recents" className={GROUP_CLASS}>
                    {recents.map((session) => (
                      <SessionRowActions key={session.id} onOpen={() => openRowActions(session.id)}>
                        <CommandItem
                          icon={<MessageSquare />}
                          value={`session:${session.id}`}
                          onSelect={() => select(() => openSession(session.id))}
                          rowActions
                        >
                          {session.title}
                        </CommandItem>
                      </SessionRowActions>
                    ))}
                  </Command.Group>
                )}

                <Command.Group heading="Actions" className={GROUP_CLASS}>
                  {actions.map((action) =>
                    action.shortcut === undefined ? (
                      <CommandItem
                        key={action.label}
                        value={`action:${action.label}`}
                        icon={action.icon}
                        onSelect={() => select(action.run)}
                      >
                        {action.label}
                      </CommandItem>
                    ) : (
                      <ShortcutCommandItem
                        key={action.label}
                        value={`action:${action.label}`}
                        id={action.shortcut}
                        icon={action.icon}
                        onSelect={() => select(action.run)}
                      >
                        {action.label}
                      </ShortcutCommandItem>
                    ),
                  )}
                </Command.Group>
              </>
            )}

            {showResults && (
              // cmdk's Group forces role=presentation, so upstream's headingless group is a plain div.
              <div
                role="group"
                aria-label="Search results"
                aria-busy={searching}
                className="flex flex-col gap-1"
              >
                {listing?.map((row) => (
                  <SearchResultItem
                    key={rowKey(row)}
                    row={row}
                    now={now}
                    onSelect={() => select(() => openRow(row))}
                    onRowActions={() => openRowActions(row.id)}
                  />
                ))}
                {instant.map((row) => (
                  <SearchResultItem
                    key={rowKey(row)}
                    row={row}
                    now={now}
                    onSelect={() => select(() => openRow(row))}
                    onRowActions={() => openRowActions(row.id)}
                  />
                ))}
                {matchedActions.map((action) =>
                  action.shortcut === undefined ? (
                    <CommandItem
                      key={action.label}
                      value={`action:${action.label}`}
                      icon={action.icon}
                      onSelect={() => select(action.run)}
                    >
                      {action.label}
                    </CommandItem>
                  ) : (
                    <ShortcutCommandItem
                      key={action.label}
                      value={`action:${action.label}`}
                      id={action.shortcut}
                      icon={action.icon}
                      onSelect={() => select(action.run)}
                    >
                      {action.label}
                    </ShortcutCommandItem>
                  ),
                )}
                {matchedCommands.map((command) => (
                  <CommandItem
                    key={command.to}
                    value={`nav:${command.to}`}
                    icon={command.icon}
                    onSelect={() => select(() => navigate({ to: command.to }))}
                  >
                    {command.label}
                  </CommandItem>
                ))}
                {serverRows.map((row) => (
                  <SearchResultItem
                    key={rowKey(row)}
                    row={row}
                    now={now}
                    onSelect={() => select(() => openRow(row))}
                    onRowActions={() => openRowActions(row.id)}
                  />
                ))}
                {searching &&
                  Array.from({ length: SKELETON_ROWS }, (_, index) => (
                    <div
                      key={index}
                      aria-hidden="true"
                      data-palette-skeleton=""
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <span className="size-5 shrink-0 rounded bg-fill-ghost-hover" />
                      <span className="h-3 flex-1 rounded bg-fill-ghost-hover motion-safe:animate-pulse" />
                    </div>
                  ))}
                {!searching && resultCount === 0 && type === "all" && (
                  <div className="px-3 py-2 text-sm text-secondary">
                    No results for “{trimmedQuery}”
                  </div>
                )}
                {!searching && resultCount === 0 && type !== "all" && (
                  <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-sm text-secondary">
                    <span>
                      No results for “{tokens.text}” in {paletteTypeLabels[type]}
                    </span>
                    <button
                      type="button"
                      onClick={searchAll}
                      className="rounded-r6 px-2 py-1 text-xs text-primary transition-colors hover:bg-fill-ghost-hover focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none"
                    >
                      Search all
                    </button>
                  </div>
                )}
                {tokens.text !== "" && type !== "projects" && (
                  <CommandItem
                    value="see-all-results"
                    icon={<Search />}
                    onSelect={() => select(() => seeAllResults(type))}
                  >
                    See all results for “{tokens.text}”
                  </CommandItem>
                )}
              </div>
            )}
          </Command.List>
          {showResults && !searching && (
            <div aria-live="polite" className="sr-only">
              {resultCount} results available
            </div>
          )}

          {!compose && query === "" && (
            <div
              data-palette-footer=""
              className="border-t-[0.5px] border-border bg-surface-3 py-2.5 pr-4 pl-5 pointer-coarse:hidden"
            >
              <div className="flex min-h-5 items-center gap-5 text-xs text-ink-muted">
                <span className="flex items-center gap-2">
                  <span>Close</span>
                  <Shortcut keys="esc" />
                </span>
                <span className="flex items-center gap-2">
                  <span>Filters</span>
                  <Shortcut keys="/" />
                </span>
                <span className="flex items-center gap-2">
                  <span>Actions</span>
                  <Shortcut keys="right" />
                </span>
              </div>
            </div>
          )}
        </Command>
      </div>
      {rowActions !== null && (
        <PaletteRowActionsCard
          key={rowActions.session.id}
          session={rowActions.session}
          top={rowActions.top}
          onOpen={(id) => select(() => openSession(id))}
          onClose={closeRowActions}
        />
      )}
    </Dialog.Popup>
  );
}

/** Upstream's 28px type tablist under the input; cloud-only tabs are replaced by local types. */
function TypeTabs({
  value,
  onChange,
}: {
  value: PaletteType;
  onChange: (type: PaletteType) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Type"
      className="flex items-center gap-1 overflow-x-auto px-6 pb-[0.9rem]"
    >
      {PaletteTypeSchema.options.map((type) => {
        const selected = type === value;
        return (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(type)}
            className={`h-7 shrink-0 rounded-r6 px-2 text-sm transition-colors hover:bg-fill-ghost-hover hover:text-primary ${
              selected ? "bg-fill-ghost-hover font-medium text-primary" : "text-secondary"
            }`}
          >
            {paletteTypeLabels[type]}
          </button>
        );
      })}
    </div>
  );
}

/** Upstream's floating [Search] [Compose Tab] segmented control, 12px above the card. */
function ModeSwitch({
  mode,
  onModeChange,
}: {
  mode: PaletteMode;
  onModeChange: (mode: PaletteMode) => void;
}) {
  const options: Array<{ value: PaletteMode; label: string; keys?: string }> = [
    { value: "search", label: "Search" },
    { value: "compose", label: "Compose", keys: "tab" },
  ];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full hidden justify-center pb-3 sm:flex">
      <div className="pointer-events-auto flex items-center rounded-[calc(var(--radius-r6)+1px)] border-[0.5px] border-strong bg-surface-3 p-px shadow-pop">
        <div
          role="radiogroup"
          aria-label="Search or compose"
          className="relative inline-flex h-7 w-fit shrink-0 items-stretch rounded-r6 bg-[var(--settings-segmented-track)] p-px font-sans"
        >
          {options.map((option) => {
            const checked = option.value === mode;
            return (
              <span
                key={option.value}
                role="radio"
                aria-checked={checked}
                tabIndex={-1}
                data-checked={checked ? "" : undefined}
                onClick={() => onModeChange(option.value)}
                className="relative inline-flex h-full cursor-pointer items-center justify-center gap-1.5 rounded-r5 px-2.5 text-sm text-ink-muted select-none hover:text-primary data-[checked]:bg-[var(--settings-segmented-thumb)] data-[checked]:text-primary data-[checked]:shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_0_rgb(0_0_0/0.05)]"
              >
                {option.label}
                {option.keys !== undefined && <Shortcut keys={option.keys} />}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Session icon with upstream's masked notch and 6px accent pulse dot at the top-right. */
function AttentionIcon() {
  return (
    <span className="relative flex size-5 items-center justify-center">
      <MessageSquare className="[mask-image:radial-gradient(circle_at_calc(100%-2px)_2px,transparent_5px,black_5.5px)]" />
      <span
        aria-hidden="true"
        data-palette-attention-dot=""
        className="absolute top-0 right-0 size-1.5 rounded-full bg-accent-100 motion-safe:animate-pulse"
      />
    </span>
  );
}

/** A command row advertising its registry shortcut as keycaps and `aria-keyshortcuts`. */
function ShortcutCommandItem({
  id,
  ...props
}: { id: ShortcutId } & Omit<Parameters<typeof CommandItem>[0], "shortcut">) {
  const shortcut = useShortcutKeys(id);
  return <CommandItem {...props} shortcut={shortcut} />;
}

const ROW_CLASS =
  "peer group flex w-full cursor-pointer items-center justify-between gap-3 truncate rounded-lg px-3 py-2 text-sm leading-5 text-secondary select-none data-[selected=true]:bg-fill-ghost-hover data-[selected=true]:text-primary";

function ReturnGlyph() {
  return (
    <span className="hidden shrink-0 text-xs text-ink-muted group-data-[selected=true]:inline-flex pointer-coarse:!hidden">
      <CornerDownLeft aria-hidden="true" className="size-4" />
    </span>
  );
}

/** A session row with upstream's hover "…" that opens the → row-actions card. */
function SessionRowActions({ children, onOpen }: { children: ReactNode; onOpen: () => void }) {
  return (
    <div className="group/palette-row relative">
      {children}
      <PaletteRowActionsButton onOpen={onOpen} />
    </div>
  );
}

const ROW_ACTIONS_LABEL_CLASS = "mr-7 pointer-coarse:mr-0";

/** Upstream's search row: kind icon, bold title runs, quoted snippet, bucket meta, ⏎ when selected. */
function SearchResultItem({
  row,
  now,
  onSelect,
  onRowActions,
}: {
  row: SearchRow;
  now: number;
  onSelect: () => void;
  onRowActions: () => void;
}) {
  const session = row.kind === "session";
  const item = (
    <Command.Item
      value={rowKey(row)}
      onSelect={onSelect}
      data-item-type={row.kind}
      {...(session ? { "aria-keyshortcuts": "ArrowRight" } : {})}
      className={ROW_CLASS}
    >
      <span
        className={`flex min-w-0 flex-1 items-center gap-2 ${session ? ROW_ACTIONS_LABEL_CLASS : ""}`}
      >
        <span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-[18px]">
          {row.awaiting ? <AttentionIcon /> : KIND_ICONS[row.kind]}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span data-palette-label="" className="truncate">
            <HighlightRuns text={row.title} matches={row.titleMatches} />
          </span>
          {row.snippet !== undefined && row.snippet.text !== "" && (
            <span
              data-palette-snippet=""
              className="text-xs text-ink-muted max-w-[60%] shrink-0 overflow-hidden whitespace-nowrap"
            >
              “<HighlightRuns text={row.snippet.text} matches={row.snippet.matches} />”
            </span>
          )}
        </span>
        {row.awaiting && <span className="sr-only"> Awaiting input</span>}
      </span>
      <span
        data-palette-meta=""
        className="shrink-0 text-xs text-ink-muted group-data-[selected=true]:hidden pointer-coarse:!inline"
      >
        {relativeBucket(Date.parse(row.mtime), now) ?? ""}
      </span>
      <ReturnGlyph />
    </Command.Item>
  );
  return session ? <SessionRowActions onOpen={onRowActions}>{item}</SessionRowActions> : item;
}

function CommandItem({
  children,
  value,
  icon,
  onSelect,
  shortcut,
  rowActions = false,
}: {
  children: ReactNode;
  value: string;
  icon: ReactNode;
  onSelect: () => void;
  shortcut?: ShortcutKeys;
  rowActions?: boolean;
}) {
  const keyShortcuts = rowActions ? "ArrowRight" : shortcut?.ariaKeyShortcuts;
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      {...(keyShortcuts === undefined ? {} : { "aria-keyshortcuts": keyShortcuts })}
      className={ROW_CLASS}
    >
      <span
        className={`flex min-w-0 flex-1 items-center gap-2 ${rowActions ? ROW_ACTIONS_LABEL_CLASS : ""}`}
      >
        <span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-[18px]">
          {icon}
        </span>
        <span data-palette-label="" className="truncate">
          {children}
        </span>
      </span>
      {shortcut !== undefined && (
        <span
          aria-hidden="true"
          className="shrink-0 text-ink-muted group-data-[selected=true]:hidden pointer-coarse:hidden"
        >
          <Shortcut keys={shortcut.keys} />
        </span>
      )}
      <ReturnGlyph />
    </Command.Item>
  );
}
