import { z } from "zod";

import { assertNever } from "./assert-never";

/** The pinned first tab: the live herdr pane running the session's TUI. */
export const CLAUDE_TAB_ID = "claude";

export interface ShellTab {
  id: string;
  ptyKey: string;
  title: string;
  /** A close frame has been requested; the tab goes once the socket confirms. */
  closing: boolean;
}

export interface TerminalTabsState {
  tabs: readonly ShellTab[];
  /** The selected tab id, `CLAUDE_TAB_ID`, or null for the pane's default. */
  active: string | null;
  /** Shell tabs ever opened in this session, for "Shell N" titles and tab ids. */
  opened: number;
}

export const EMPTY_TERMINAL_TABS: TerminalTabsState = { tabs: [], active: null, opened: 0 };

export type TerminalTabsAction =
  | { type: "add"; ptyKey: string }
  | { type: "select"; id: string }
  | { type: "rename"; id: string; title: string }
  | { type: "request-close"; ids: readonly string[] }
  | { type: "close-others"; id: string }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; delta: -1 | 1 }
  | { type: "restart"; id: string; ptyKey: string };

function markClosing(state: TerminalTabsState, ids: ReadonlySet<string>): TerminalTabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (ids.has(tab.id) ? { ...tab, closing: true } : tab)),
  };
}

/**
 * Shell tabs of one session's Terminal pane. Claude is not in `tabs`: it is
 * pinned first, cannot be closed or moved, and only ever appears as a
 * selection or as the tab kept by Close other terminals.
 */
export function reduceTerminalTabs(
  state: TerminalTabsState,
  action: TerminalTabsAction,
): TerminalTabsState {
  switch (action.type) {
    case "add": {
      const opened = state.opened + 1;
      const id = `shell-${opened}`;
      const title = opened === 1 ? "Shell" : `Shell ${opened}`;
      return {
        tabs: [...state.tabs, { id, ptyKey: action.ptyKey, title, closing: false }],
        active: id,
        opened,
      };
    }
    case "select":
      return { ...state, active: action.id };
    case "rename": {
      const title = action.title.trim();
      if (title === "") return state;
      return {
        ...state,
        tabs: state.tabs.map((tab) => (tab.id === action.id ? { ...tab, title } : tab)),
      };
    }
    case "request-close":
      return markClosing(state, new Set(action.ids));
    case "close-others":
      return {
        ...markClosing(
          state,
          new Set(state.tabs.filter((tab) => tab.id !== action.id).map((tab) => tab.id)),
        ),
        active: action.id,
      };
    case "remove": {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index === -1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      if (state.active !== action.id) return { ...state, tabs };
      const neighbour = index > 0 ? tabs[index - 1] : undefined;
      return { ...state, tabs, active: neighbour?.id ?? null };
    }
    case "move": {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      const target = index + action.delta;
      if (index === -1 || target < 0 || target >= state.tabs.length) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(index, 1);
      if (moved === undefined) return state;
      tabs.splice(target, 0, moved);
      return { ...state, tabs };
    }
    case "restart":
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.id ? { ...tab, ptyKey: action.ptyKey, closing: false } : tab,
        ),
      };
    default:
      return assertNever(action);
  }
}

export type CloseGuard =
  | { confirm: false }
  | { confirm: true; title: string; body: string; confirmLabel: string };

/**
 * Upstream's busy guard: closing a terminal whose shell is still running a
 * command asks first. Close other terminals names the one busy tab, or counts
 * them when there are several.
 */
export function closeGuard(
  kind: "close" | "close-others",
  targets: readonly ShellTab[],
  busyPtyKeys: ReadonlySet<string>,
): CloseGuard {
  const busy = targets.filter((tab) => busyPtyKeys.has(tab.ptyKey));
  const [first] = busy;
  if (first === undefined) return { confirm: false };
  if (kind === "close") {
    return {
      confirm: true,
      title: "Close terminal?",
      body: `A command is still running in ${first.title}. Closing the terminal stops it.`,
      confirmLabel: "Close terminal",
    };
  }
  return {
    confirm: true,
    title: "Close other terminals?",
    body:
      busy.length === 1
        ? `A command is still running in ${first.title}. Closing the other terminals stops it.`
        : `Commands are still running in ${busy.length} terminals. Closing the other terminals stops them.`,
    confirmLabel: "Close other terminals",
  };
}

export function terminalTabsStorageKey(sessionId: string): string {
  return `ccp-terminal-tabs:${sessionId}`;
}

const StoredTerminalTabsSchema = z
  .object({
    tabs: z.array(
      z
        .object({ id: z.string().min(1), ptyKey: z.string().min(1), title: z.string().min(1) })
        .strict(),
    ),
    active: z.string().min(1).nullable(),
    opened: z.number().int().nonnegative(),
  })
  .strict();

/** Tabs already closing are left out: their shells are on the way out. */
export function serializeTerminalTabs(state: TerminalTabsState): string {
  return JSON.stringify({
    tabs: state.tabs
      .filter((tab) => !tab.closing)
      .map(({ id, ptyKey, title }) => ({ id, ptyKey, title })),
    active: state.active,
    opened: state.opened,
  });
}

export function restoreTerminalTabs(raw: string | null): TerminalTabsState {
  if (raw === null) return EMPTY_TERMINAL_TABS;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return EMPTY_TERMINAL_TABS;
  }
  const parsed = StoredTerminalTabsSchema.safeParse(json);
  if (!parsed.success) return EMPTY_TERMINAL_TABS;
  return {
    tabs: parsed.data.tabs.map((tab) => ({ ...tab, closing: false })),
    active: parsed.data.active,
    opened: parsed.data.opened,
  };
}
