import { ChevronDown, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { CLAUDE_TAB_ID, type ShellTab } from "../../lib/terminal-tabs";
import { InlineRenameInput } from "../inline-rename-input";
import {
  ContextMenu,
  ContextMenuTrigger,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "../ui/menu";

const TAB_CLASS =
  "flex h-6 shrink-0 cursor-pointer items-center rounded-r5 px-1.5 text-body whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-accent-100 aria-selected:bg-fill-control aria-selected:text-primary text-secondary hover:text-primary";

export const GHOST_ICON_BUTTON =
  "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary disabled:cursor-default disabled:opacity-50";

const SHELL_TAB_HINT_ID = "terminal-tab-hint";

export interface TerminalTabActions {
  rename: (id: string, title: string) => void;
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  move: (id: string, delta: -1 | 1) => void;
}

/**
 * The Terminal pane's tab strip: Claude pinned first (not closable, not
 * movable) and the Shell tabs after it. Every tab has upstream's menu on
 * right-click (Rename terminal / Close terminal / Close other terminals, only
 * the last on Claude); Delete or Backspace closes the focused Shell tab and
 * Control+Shift+Left/Right moves it. When the tabs overflow the strip,
 * "More terminals" lists them all.
 */
export function TerminalTabStrip({
  showClaude,
  tabs,
  active,
  actions,
  onActivate,
}: {
  showClaude: boolean;
  tabs: readonly ShellTab[];
  active: string | null;
  actions: TerminalTabActions;
  /** A tab was chosen by pointer or menu: move focus into its terminal. */
  onActivate: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const refocus = useRef<string | null>(null);
  const afterMenuClose = useRef<(() => void) | null>(null);
  const tabCount = tabs.length + (showClaude ? 1 : 0);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => setOverflowing(list.scrollWidth > list.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [tabCount]);

  useEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)?.focus();
  });

  const onMenuOpenChangeComplete = (open: boolean) => {
    if (open) return;
    const action = afterMenuClose.current;
    afterMenuClose.current = null;
    action?.();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (id === CLAUDE_TAB_ID) return;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    if (plain && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      actions.close(id);
      return;
    }
    const moveChord = event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
    if (moveChord && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      event.stopPropagation();
      refocus.current = id;
      actions.move(id, event.key === "ArrowLeft" ? -1 : 1);
    }
  };

  const tabButton = (id: string, title: string, shell: boolean) => (
    <button
      type="button"
      role="tab"
      data-tab-id={id}
      aria-selected={active === id}
      aria-controls={`terminal-pane-${id}`}
      aria-describedby={shell ? SHELL_TAB_HINT_ID : undefined}
      onClick={() => onActivate(id)}
      onKeyDown={(event) => onTabKeyDown(event, id)}
      className={TAB_CLASS}
    >
      {title}
    </button>
  );

  const menuFor = (id: string, trigger: ReactNode, items: ReactNode) => (
    <ContextMenu
      key={id}
      disabled={items === null || renaming === id}
      onOpenChangeComplete={onMenuOpenChangeComplete}
    >
      <ContextMenuTrigger className="flex shrink-0 items-center">{trigger}</ContextMenuTrigger>
      <MenuContent>{items}</MenuContent>
    </ContextMenu>
  );

  const closeOthersItem = (id: string) => (
    <MenuItem
      disabled={tabs.every((tab) => tab.id === id)}
      onSelect={() => actions.closeOthers(id)}
    >
      Close other terminals
    </MenuItem>
  );

  return (
    <>
      <div
        ref={listRef}
        role="tablist"
        aria-label="Terminals"
        className="flex min-w-0 items-center gap-0.5 overflow-hidden"
      >
        {showClaude &&
          menuFor(
            CLAUDE_TAB_ID,
            tabButton(CLAUDE_TAB_ID, "Claude", false),
            tabs.length > 0 ? closeOthersItem(CLAUDE_TAB_ID) : null,
          )}
        {tabs.map((tab) =>
          menuFor(
            tab.id,
            <>
              {renaming === tab.id ? (
                <InlineRenameInput
                  value={tab.title}
                  ariaLabel="Rename terminal"
                  className="h-6 w-24 px-1.5"
                  onCommit={(title) => {
                    actions.rename(tab.id, title);
                    refocus.current = tab.id;
                    setRenaming(null);
                  }}
                  onCancel={() => {
                    refocus.current = tab.id;
                    setRenaming(null);
                  }}
                />
              ) : (
                tabButton(tab.id, tab.title, true)
              )}
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                disabled={tab.closing}
                onClick={() => actions.close(tab.id)}
                className={GHOST_ICON_BUTTON}
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </>,
            <>
              <MenuItem
                onSelect={() => {
                  afterMenuClose.current = () => setRenaming(tab.id);
                }}
              >
                Rename terminal
              </MenuItem>
              <MenuItem onSelect={() => actions.close(tab.id)}>Close terminal</MenuItem>
              {closeOthersItem(tab.id)}
            </>,
          ),
        )}
      </div>
      <span id={SHELL_TAB_HINT_ID} hidden>
        Press Delete or Backspace to close the terminal. Press Control+Shift+Left Arrow or Right
        Arrow to move the terminal.
      </span>
      {overflowing && (
        <Menu>
          <MenuTrigger
            aria-label="More terminals"
            title="More terminals"
            className={GHOST_ICON_BUTTON}
          >
            <ChevronDown aria-hidden="true" className="size-4" />
          </MenuTrigger>
          <MenuContent>
            {showClaude && <MenuItem onSelect={() => onActivate(CLAUDE_TAB_ID)}>Claude</MenuItem>}
            {tabs.map((tab) => (
              <MenuItem key={tab.id} onSelect={() => onActivate(tab.id)}>
                {tab.title}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      )}
    </>
  );
}
