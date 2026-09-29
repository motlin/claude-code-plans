import { Dialog } from "@base-ui/react/dialog";
import { Command } from "cmdk";
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
} from "lucide-react";
import type { PaletteMode } from "../hooks/use-command-palette";
import { recentSessionsQueryOptions, type SessionListItem } from "../lib/api/sessions";
import type { SessionBucket } from "../lib/session-state";
import { SHORTCUTS, type ShortcutId } from "../lib/shortcuts/registry";
import { toggleSidebarCollapsed } from "../lib/sidebar-store";
import { type ShortcutKeys, useShortcutKeys } from "../hooks/use-shortcut";
import { clearAll } from "../lib/unread-store";
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
  const cardRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [settledHeight, setSettledHeight] = useState<number | null>(null);
  const { data } = useQuery(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT));
  const currentSessionId = useCurrentSessionId();

  const { attention, recents } = useMemo(
    () => paletteSessionGroups(data?.sessions ?? [], currentSessionId),
    [data, currentSessionId],
  );

  function openSession(id: string) {
    void navigate({ to: "/session/$id", params: { id } });
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
    if (event.key !== "Tab" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onModeChange(mode === "search" ? "compose" : "search");
  }

  const compose = mode === "compose";
  const label = MODE_LABELS[mode];

  return (
    <Dialog.Popup
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
        className={`overflow-hidden border-[0.5px] border-strong bg-surface-3 shadow-2xl ${PALETTE_RADIUS}`}
      >
        <Command label={label} loop onKeyDown={handleKeyDown} className="flex flex-col">
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
            <Dialog.Close
              aria-label="Close"
              className="relative flex aspect-square h-7 w-7 shrink-0 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <div className="h-[0.5px] w-full bg-border" />

          <Command.List className="max-h-[440px] overflow-y-auto p-2.5">
            {!compose && (
              <>
                <Command.Empty className="px-6 py-6 text-center text-secondary">
                  No results for “{query}”
                </Command.Empty>

                {attention.length > 0 && (
                  <Command.Group heading="Needs attention" className={GROUP_CLASS}>
                    {attention.map((session) => (
                      <CommandItem
                        key={session.id}
                        icon={<AttentionIcon />}
                        onSelect={() => select(() => openSession(session.id))}
                        keywords={[session.id]}
                      >
                        {session.title}
                        <span className="sr-only"> {ATTENTION_LABELS[session.bucket]}</span>
                      </CommandItem>
                    ))}
                  </Command.Group>
                )}

                {recents.length > 0 && (
                  <Command.Group heading="Recents" className={GROUP_CLASS}>
                    {recents.map((session) => (
                      <CommandItem
                        key={session.id}
                        icon={<MessageSquare />}
                        onSelect={() => select(() => openSession(session.id))}
                        keywords={[session.id]}
                      >
                        {session.title}
                      </CommandItem>
                    ))}
                  </Command.Group>
                )}

                <Command.Group heading="Actions" className={GROUP_CLASS}>
                  {actions.map((action) =>
                    action.shortcut === undefined ? (
                      <CommandItem
                        key={action.label}
                        icon={action.icon}
                        onSelect={() => select(action.run)}
                      >
                        {action.label}
                      </CommandItem>
                    ) : (
                      <ShortcutCommandItem
                        key={action.label}
                        id={action.shortcut}
                        icon={action.icon}
                        onSelect={() => select(action.run)}
                      >
                        {action.label}
                      </ShortcutCommandItem>
                    ),
                  )}
                </Command.Group>

                {query !== "" && (
                  <Command.Group className={GROUP_CLASS}>
                    {NAV_COMMANDS.map((command) => (
                      <CommandItem
                        key={command.to}
                        icon={command.icon}
                        onSelect={() => select(() => navigate({ to: command.to }))}
                        keywords={command.keywords}
                      >
                        {command.label}
                      </CommandItem>
                    ))}
                  </Command.Group>
                )}
              </>
            )}
          </Command.List>

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
                  <span>Actions</span>
                  <Shortcut keys="right" />
                </span>
              </div>
            </div>
          )}
        </Command>
      </div>
    </Dialog.Popup>
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

function CommandItem({
  children,
  icon,
  onSelect,
  keywords,
  shortcut,
}: {
  children: ReactNode;
  icon: ReactNode;
  onSelect: () => void;
  keywords?: readonly string[];
  shortcut?: ShortcutKeys;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      {...(keywords ? { keywords: [...keywords] } : {})}
      {...(shortcut ? { "aria-keyshortcuts": shortcut.ariaKeyShortcuts } : {})}
      className="group flex w-full cursor-pointer items-center justify-between gap-3 truncate rounded-lg px-3 py-2 text-sm leading-5 text-secondary select-none data-[selected=true]:bg-fill-ghost-hover data-[selected=true]:text-primary"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
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
      <span className="hidden shrink-0 text-xs text-ink-muted group-data-[selected=true]:inline-flex pointer-coarse:!hidden">
        <CornerDownLeft aria-hidden="true" className="size-4" />
      </span>
    </Command.Item>
  );
}
