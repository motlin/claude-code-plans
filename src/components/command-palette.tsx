import { Dialog } from "@base-ui/react/dialog";
import { Command } from "cmdk";
import { useNavigate } from "@tanstack/react-router";
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
} from "lucide-react";
import type { PaletteMode } from "../hooks/use-command-palette";
import { recentSessionsQueryOptions } from "../lib/api/sessions";
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

interface RecentSession {
  id: string;
  title: string;
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
  const { data } = useQuery(recentSessionsQueryOptions(8));

  const recentSessions = useMemo<RecentSession[]>(
    () => (data?.sessions ?? []).map((s) => ({ id: s.id, title: s.title })),
    [data],
  );

  // Upstream centres the card on its first settled height so it does not jump while filtering.
  useLayoutEffect(() => {
    const height = cardRef.current?.offsetHeight ?? 0;
    if (settledHeight === null && height > 0) setSettledHeight(height);
  }, [settledHeight, recentSessions.length]);

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

                {recentSessions.length > 0 && (
                  <Command.Group heading="Recents" className={GROUP_CLASS}>
                    {recentSessions.map((session) => (
                      <CommandItem
                        key={session.id}
                        icon={<MessageSquare />}
                        onSelect={() =>
                          select(() =>
                            navigate({
                              to: "/session/$id",
                              params: { id: session.id },
                            }),
                          )
                        }
                        keywords={[session.id]}
                      >
                        {session.title}
                      </CommandItem>
                    ))}
                  </Command.Group>
                )}

                <Command.Group heading="Actions" className={GROUP_CLASS}>
                  <CommandItem icon={<Home />} onSelect={() => select(() => navigate({ to: "/" }))}>
                    Home
                  </CommandItem>
                  <CommandItem
                    icon={<Search />}
                    onSelect={() =>
                      select(() =>
                        navigate({
                          to: "/search",
                          search: { q: "", mode: "titles" as const },
                        }),
                      )
                    }
                  >
                    Search
                  </CommandItem>
                  <CommandItem icon={<CircleCheckBig />} onSelect={() => select(clearAll)}>
                    Mark all sessions seen
                  </CommandItem>
                  <CommandItem
                    icon={<Star />}
                    onSelect={() => select(() => navigate({ to: "/starred" }))}
                  >
                    Starred
                  </CommandItem>
                  <CommandItem
                    icon={<FolderOpen />}
                    onSelect={() => select(() => navigate({ to: "/projects" }))}
                  >
                    Projects
                  </CommandItem>
                  <CommandItem
                    icon={<FileText />}
                    onSelect={() => select(() => navigate({ to: "/plans" }))}
                  >
                    Plans
                  </CommandItem>
                  <CommandItem
                    icon={<Brain />}
                    onSelect={() => select(() => navigate({ to: "/memories" }))}
                  >
                    Memories
                  </CommandItem>
                  <CommandItem
                    icon={<MessageSquare />}
                    onSelect={() => select(() => navigate({ to: "/sessions" }))}
                  >
                    Sessions
                  </CommandItem>
                  <CommandItem
                    icon={<SlidersHorizontal />}
                    onSelect={() => select(() => openSettings("general"))}
                  >
                    Settings
                  </CommandItem>
                  <CommandItem
                    icon={<Keyboard />}
                    onSelect={() => select(() => setKeyboardShortcutsOpen(true))}
                  >
                    Keyboard shortcuts
                  </CommandItem>
                </Command.Group>
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

function CommandItem({
  children,
  icon,
  onSelect,
  keywords,
}: {
  children: ReactNode;
  icon: ReactNode;
  onSelect: () => void;
  keywords?: string[];
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      {...(keywords ? { keywords } : {})}
      className="group flex w-full cursor-pointer items-center justify-between gap-3 truncate rounded-lg px-3 py-2 text-sm leading-5 text-secondary select-none data-[selected=true]:bg-fill-ghost-hover data-[selected=true]:text-primary"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-[18px]">
          {icon}
        </span>
        <span className="truncate">{children}</span>
      </span>
      <span className="hidden shrink-0 text-xs text-ink-muted group-data-[selected=true]:inline-flex pointer-coarse:!hidden">
        <CornerDownLeft aria-hidden="true" className="size-4" />
      </span>
    </Command.Item>
  );
}
