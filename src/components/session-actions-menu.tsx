import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Ellipsis } from "lucide-react";
import { createContext, type ReactNode, useContext, useRef } from "react";

import { herdrPanesQueryOptions } from "../lib/api/herdr";
import {
  openSessionInFinder,
  sessionOpenInQueryOptions,
  useToggleSessionStar,
  type SessionListItem,
} from "../lib/api/sessions";
import { assertNever } from "../lib/assert-never";
import { useSessionArchive } from "../hooks/use-session-archive";
import { useSessionFork } from "../hooks/use-session-fork";
import { type SessionRename, useSessionRename } from "../hooks/use-session-rename";
import {
  getSessionMenuItems,
  type SessionMenuCapability,
  type SessionMenuEntry,
  type SessionMenuItemId,
  type SessionMenuSession,
  sessionMenuReadState,
} from "../lib/session-menu-items";
import {
  claudeAiSessionUrl,
  copySessionLink,
  copySessionResumeCommand,
  openPullRequest,
  vscodeFolderUrl,
} from "../lib/session-open-in";
import { forkDisabledReason } from "../lib/session-fork";
import { markSeen, markUnseen } from "../lib/unread-store";
import { InlineRenameInput } from "./inline-rename-input";
import { useHasUnseenWork } from "./session-unread-control";
import { useToast } from "./toast";
import {
  ContextMenu,
  ContextMenuTrigger,
  Menu,
  MenuContent,
  MenuHotkey,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";

/** Actions wired locally so far; the rest appear as their features land. */
export const SESSION_MENU_CAPABILITIES: ReadonlySet<SessionMenuCapability> =
  new Set<SessionMenuCapability>([
    "openLiveTerminal",
    "openTerminal",
    "openVsCode",
    "openFinder",
    "openClaudeAi",
    "openPr",
    "pin",
    "readState",
    "ackAwaiting",
    "rename",
    "copyLink",
    "fork",
    "archive",
  ]);

interface RowRename {
  rename: SessionRename;
  /** Opens the inline input once the menu has finished closing. */
  requestRename: () => void;
}

const RowRenameContext = createContext<RowRename | null>(null);

function useRowRename(): RowRename {
  const row = useContext(RowRenameContext);
  if (row === null) throw new Error("Session row titles must render inside SessionActionsMenu");
  return row;
}

/**
 * The row's title text, which the menu's Rename item swaps for an inline
 * input. `render` styles the idle title, e.g. with an overflow fade.
 */
export function SessionRowTitle({ render }: { render?: (title: string) => ReactNode }) {
  const { rename } = useRowRename();
  if (rename.editing) {
    return (
      <InlineRenameInput value={rename.title} onCommit={rename.commit} onCancel={rename.cancel} />
    );
  }
  return render === undefined ? rename.title : render(rename.title);
}

export interface SessionMenuRunnerOptions {
  sessionId: string;
  cwd: string | null;
  bridgeSessionId: string | null;
  prUrl: string | null;
  /** Opens the inline rename input once the menu has finished closing. */
  requestRename: () => void;
  /** Pin/Unpin; surfaces without the pin item leave it out. */
  setPinned?: (pinned: boolean) => void;
}

/** Runs one session menu item; shared by the row menu and the titlebar chevron menu. */
export function useSessionMenuRunner({
  sessionId,
  cwd,
  bridgeSessionId,
  prUrl,
  requestRename,
  setPinned,
}: SessionMenuRunnerOptions): (id: SessionMenuItemId) => void {
  const toast = useToast();
  const setArchived = useSessionArchive(sessionId);
  const navigate = useNavigate();
  const fork = useSessionFork();

  const revealInFinder = () => {
    openSessionInFinder(sessionId).catch(() => {
      toast({ kind: "error", message: "Couldn’t open the folder in Finder." });
    });
  };

  return (id: SessionMenuItemId): void => {
    switch (id) {
      case "open-live-terminal":
        void navigate({ to: "/herdr/terminal/$sessionId", params: { sessionId } });
        return;
      case "open-terminal":
        if (cwd !== null) void copySessionResumeCommand(sessionId, cwd, toast);
        return;
      case "open-vscode":
        if (cwd !== null) window.open(vscodeFolderUrl(cwd), "_self");
        return;
      case "open-finder":
        revealInFinder();
        return;
      case "open-claude-ai":
        if (bridgeSessionId !== null) {
          window.open(claudeAiSessionUrl(bridgeSessionId), "_blank", "noopener,noreferrer");
        }
        return;
      case "open-pr":
        if (prUrl !== null) openPullRequest(prUrl);
        return;
      case "pin":
      case "unpin":
        setPinned?.(id === "pin");
        return;
      case "mark-read":
      case "mark-completed":
        markSeen(sessionId);
        return;
      case "mark-unread":
        markUnseen(sessionId);
        return;
      case "copy-link":
        void copySessionLink(sessionId, toast);
        return;
      case "rename":
        requestRename();
        return;
      case "archive":
      case "unarchive":
        setArchived(id === "archive");
        return;
      case "fork":
        if (cwd !== null) fork({ sessionId, cwd });
        return;
      case "open-in":
        return;
      default:
        assertNever(id);
    }
  };
}

function useSessionMenu(session: SessionListItem) {
  const unseen = useHasUnseenWork(session.id);
  const { data: herdr } = useQuery(herdrPanesQueryOptions);
  const { data: openIn } = useQuery(sessionOpenInQueryOptions(session.id));
  const cwd = openIn?.cwd ?? null;
  const bridgeSessionId = openIn?.bridgeSessionId ?? null;
  const star = useToggleSessionStar(session.id);
  const { requestRename } = useRowRename();

  const menuSession: SessionMenuSession = {
    title: session.title,
    pinned: session.starred,
    readState: sessionMenuReadState(session.bucket, unseen),
    archived: session.archived,
    prUrl: session.pr?.url ?? null,
    hasLivePane: herdr?.panes.some((pane) => pane.sessionId === session.id) ?? false,
    forkDisabledReason: forkDisabledReason({ working: session.bucket === "working", cwd }),
    cwd,
    bridgeSessionId,
  };

  const run = useSessionMenuRunner({
    sessionId: session.id,
    cwd,
    bridgeSessionId,
    prUrl: session.pr?.url ?? null,
    requestRename,
    setPinned: (pinned) => star.mutate(pinned),
  });

  return {
    entries: getSessionMenuItems(menuSession, SESSION_MENU_CAPABILITIES, { surface: "row" }),
    run,
  };
}

export function MenuEntries({
  entries,
  run,
}: {
  entries: SessionMenuEntry[];
  run: (id: SessionMenuItemId) => void;
}) {
  return entries.map((entry, index) => {
    if (entry.kind === "separator") return <MenuSeparator key={`separator-${index}`} />;
    if (entry.kind === "hotkey") {
      return (
        <MenuHotkey
          key={`hotkey-${entry.id}`}
          accelerator={entry.accelerator}
          onSelect={() => run(entry.id)}
        />
      );
    }
    if (entry.submenu !== undefined) {
      return (
        <MenuSub key={entry.id}>
          <MenuSubTrigger>{entry.label}</MenuSubTrigger>
          <MenuSubContent>
            <MenuEntries entries={entry.submenu} run={run} />
          </MenuSubContent>
        </MenuSub>
      );
    }
    return (
      <MenuItem
        key={entry.id}
        {...(entry.accelerator === undefined ? {} : { accelerator: entry.accelerator })}
        {...(entry.hiddenAccelerator ? { hideAccelerator: true } : {})}
        {...(entry.disabled ? { disabled: true } : {})}
        {...(entry.disabledReason === undefined ? {} : { title: entry.disabledReason })}
        onSelect={() => run(entry.id)}
      >
        {entry.label}
      </MenuItem>
    );
  });
}

/** Mounted only while a menu is open, so closed rows never query or subscribe. */
function SessionMenuBody({ session }: { session: SessionListItem }) {
  const { entries, run } = useSessionMenu(session);
  return <MenuEntries entries={entries} run={run} />;
}

/**
 * The open menu holds focus, so the rename input may only mount (and take
 * focus) once the menu has closed; the closing menu must not hand focus back.
 */
export function useRenameAfterMenuClose(startEditing: () => void) {
  const renameAfterClose = useRef(false);
  return {
    requestRename: () => {
      renameAfterClose.current = true;
    },
    onOpenChangeComplete: (open: boolean) => {
      if (open || !renameAfterClose.current) return;
      renameAfterClose.current = false;
      startEditing();
    },
    finalFocus: () => !renameAfterClose.current,
  };
}

const KEBAB_CLASS =
  "absolute top-1/2 right-[calc((var(--sb-row-h,32px)-24px)/2)] flex size-6 -translate-y-1/2 items-center justify-center rounded-r6 text-ink-muted opacity-0 transition-opacity hover:bg-fill-ghost-hover hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 group-hover/session-row:opacity-100 data-[popup-open]:opacity-100 data-[popup-open]:bg-fill-ghost-hover pointer-coarse:opacity-100";

/**
 * claude.ai/code's session row actions: a 24px hover kebab ("More options for
 * <title>") opening an end-aligned dropdown, and right-click anywhere on the
 * row opening the same items at the pointer.
 */
export function SessionActionsMenu({
  session,
  children,
  className,
}: {
  session: SessionListItem;
  children: ReactNode;
  className?: string;
}) {
  const rename = useSessionRename(session.id, session.title);
  const { requestRename, onOpenChangeComplete, finalFocus } = useRenameAfterMenuClose(
    rename.startEditing,
  );
  return (
    <RowRenameContext.Provider value={{ rename, requestRename }}>
      <div className={`group/session-row relative ${className ?? ""}`}>
        <ContextMenu onOpenChangeComplete={onOpenChangeComplete}>
          <ContextMenuTrigger>{children}</ContextMenuTrigger>
          <MenuContent finalFocus={finalFocus}>
            <SessionMenuBody session={session} />
          </MenuContent>
        </ContextMenu>
        <Menu onOpenChangeComplete={onOpenChangeComplete}>
          <MenuTrigger aria-label={`More options for ${rename.title}`} className={KEBAB_CLASS}>
            <Ellipsis aria-hidden="true" className="size-4" />
          </MenuTrigger>
          <MenuContent align="end" finalFocus={finalFocus}>
            <SessionMenuBody session={session} />
          </MenuContent>
        </Menu>
      </div>
    </RowRenameContext.Provider>
  );
}
