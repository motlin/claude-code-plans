import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Ellipsis } from "lucide-react";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";

import { herdrPanesQueryOptions } from "../lib/api/herdr";
import {
  openSessionInFinder,
  sessionOpenInQueryOptions,
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
  type SessionMenuItem,
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
import { maybeShowDragPinHint } from "../lib/drag-pin-hint";
import { pin, readPinState, unpin, usePins, writePinState } from "../lib/pin-store";
import { assign, createGroup, useSessionGroups } from "../lib/session-group-store";
import { placePin } from "../lib/pinned-sessions";
import { markSeen, markUnseen } from "../lib/unread-store";
import { InlineRenameInput } from "./inline-rename-input";
import { NewGroupDialog } from "./new-group-dialog";
import { useSettings } from "./settings-provider";
import { useHasUnseenWork } from "./session-unread-control";
import { useToast } from "./toast";
import {
  ContextMenu,
  ContextMenuTrigger,
  Menu,
  MenuContent,
  MenuHotkey,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
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
    "customGroups",
    "archive",
  ]);

interface RowRename {
  rename: SessionRename;
  /** Opens the inline input once the menu has finished closing. */
  requestRename: () => void;
  /** Opens the New group dialog once the menu has finished closing. */
  requestNewGroup: () => void;
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
  /** Move up / Move down within the sidebar Pinned section. */
  movePinned?: (delta: -1 | 1) => void;
  /** Opens the New group dialog for Move to group ▸ New group…. */
  requestNewGroup?: () => void;
}

/** Runs a menu item; Move to group radios also pass the group they target. */
export type SessionMenuRun = (id: SessionMenuItemId, groupId?: string) => void;

/** Runs one session menu item; shared by the row menu and the titlebar chevron menu. */
export function useSessionMenuRunner({
  sessionId,
  cwd,
  bridgeSessionId,
  prUrl,
  requestRename,
  setPinned,
  movePinned,
  requestNewGroup,
}: SessionMenuRunnerOptions): SessionMenuRun {
  const toast = useToast();
  const setArchived = useSessionArchive(sessionId);
  const navigate = useNavigate();
  const fork = useSessionFork();

  const revealInFinder = () => {
    openSessionInFinder(sessionId).catch(() => {
      toast({ kind: "error", message: "Couldn’t open the folder in Finder." });
    });
  };

  return (id, groupId): void => {
    switch (id) {
      case "open-live-terminal":
        void navigate({
          to: "/session/$id",
          params: { id: sessionId },
          search: { pane: "terminal" },
        });
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
      case "move-up":
      case "move-down":
        movePinned?.(id === "move-up" ? -1 : 1);
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
      case "move-to-custom-group":
        if (groupId !== undefined) assign(sessionId, groupId);
        return;
      case "ungroup":
        assign(sessionId, null);
        return;
      case "new-group":
        requestNewGroup?.();
        return;
      case "open-in":
      case "move-to-group":
        return;
      default:
        assertNever(id);
    }
  };
}

/** The sidebar Pinned section's display order, for a row rendered inside it. */
interface PinnedRowContext {
  pinnedIds: readonly string[];
  /** Called after a Move up / Move down so the row takes focus once the menu closes. */
  onMoved: () => void;
}

function useSessionMenu(session: SessionListItem, pinnedRow: PinnedRowContext | undefined) {
  const unseen = useHasUnseenWork(session.id);
  const { data: herdr } = useQuery(herdrPanesQueryOptions);
  const { data: openIn } = useQuery(sessionOpenInQueryOptions(session.id));
  const cwd = openIn?.cwd ?? null;
  const bridgeSessionId = openIn?.bridgeSessionId ?? null;
  const pins = usePins();
  const customGroups = useSessionGroups();
  const { requestRename, requestNewGroup } = useRowRename();
  const pinIndex = pinnedRow?.pinnedIds.indexOf(session.id) ?? -1;

  const menuSession: SessionMenuSession = {
    title: session.title,
    pinned: pins.isPinned(session.id),
    readState: sessionMenuReadState(session.bucket, unseen),
    archived: session.archived,
    prUrl: session.pr?.url ?? null,
    hasLivePane: herdr?.panes.some((pane) => pane.sessionId === session.id) ?? false,
    forkDisabledReason: forkDisabledReason({ working: session.bucket === "working", cwd }),
    cwd,
    bridgeSessionId,
    customGroup: { groups: customGroups.groups, current: customGroups.groupOf(session.id) },
  };
  if (pinnedRow !== undefined && pinIndex !== -1) {
    menuSession.pinPosition = { index: pinIndex, count: pinnedRow.pinnedIds.length };
  }

  const run = useSessionMenuRunner({
    sessionId: session.id,
    cwd,
    bridgeSessionId,
    prUrl: session.pr?.url ?? null,
    requestRename,
    requestNewGroup,
    setPinned: (pinned) => {
      if (!pinned) {
        unpin(session.id);
        return;
      }
      pin(session.id);
      maybeShowDragPinHint();
    },
    movePinned: (delta) => {
      if (pinnedRow === undefined || pinIndex === -1) return;
      writePinState(placePin(readPinState(), pinnedRow.pinnedIds, session.id, pinIndex + delta));
      pinnedRow.onMoved();
    },
  });

  return {
    entries: getSessionMenuItems(menuSession, SESSION_MENU_CAPABILITIES, { surface: "row" }),
    run,
  };
}

/** Upstream's test hooks on the Move to group trigger and its New group… item. */
const MENU_TEST_IDS: Partial<Record<SessionMenuItemId, string>> = {
  "move-to-group": "move-to-group-trigger",
  "new-group": "new-custom-group",
};

function testIdProps(id: SessionMenuItemId) {
  const testId = MENU_TEST_IDS[id];
  return testId === undefined ? {} : { "data-testid": testId };
}

/** Radio value of a Move to group entry: its group, or the Ungrouped item's id. */
function radioValue(entry: SessionMenuItem): string {
  return entry.groupId ?? entry.id;
}

export function MenuEntries({
  entries,
  run,
}: {
  entries: SessionMenuEntry[];
  run: SessionMenuRun;
}) {
  const radios = entries.filter(
    (entry): entry is SessionMenuItem => entry.kind === "item" && entry.checked !== undefined,
  );
  if (radios.length > 0) {
    const current = radios.find((entry) => entry.checked);
    return (
      <MenuRadioGroup value={current === undefined ? null : radioValue(current)}>
        <MenuEntryList entries={entries} run={run} />
      </MenuRadioGroup>
    );
  }
  return <MenuEntryList entries={entries} run={run} />;
}

function MenuEntryList({ entries, run }: { entries: SessionMenuEntry[]; run: SessionMenuRun }) {
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
          <MenuSubTrigger {...testIdProps(entry.id)}>{entry.label}</MenuSubTrigger>
          <MenuSubContent>
            <MenuEntries entries={entry.submenu} run={run} />
          </MenuSubContent>
        </MenuSub>
      );
    }
    if (entry.checked !== undefined) {
      return (
        <MenuRadioItem
          key={radioValue(entry)}
          value={radioValue(entry)}
          closeOnClick
          {...(entry.accelerator === undefined ? {} : { accelerator: entry.accelerator })}
          onClick={() => run(entry.id, entry.groupId)}
        >
          {entry.label}
        </MenuRadioItem>
      );
    }
    return (
      <MenuItem
        key={entry.id}
        {...testIdProps(entry.id)}
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
function SessionMenuBody({
  session,
  pinnedRow,
}: {
  session: SessionListItem;
  pinnedRow: PinnedRowContext | undefined;
}) {
  const { entries, run } = useSessionMenu(session, pinnedRow);
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
  pinnedIds,
  children,
  className,
}: {
  session: SessionListItem;
  /** The sidebar Pinned section's display order, when this row is rendered inside it. */
  pinnedIds?: readonly string[];
  children: ReactNode;
  className?: string;
}) {
  const rename = useSessionRename(session.id, session.title);
  const renameAfterClose = useRenameAfterMenuClose(rename.startEditing);
  const { requestRename } = renameAfterClose;
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const newGroupAfterClose = useRenameAfterMenuClose(() => setNewGroupOpen(true));
  const { settings, setSetting } = useSettings();
  const listPrefs = settings.sessionListPrefs;
  const createGroupWithRow = (name: string) => {
    assign(session.id, createGroup(name).id);
    if (listPrefs.groupBy !== "custom") {
      setSetting("sessionListPrefs", { ...listPrefs, groupBy: "custom" });
    }
  };
  const rowRef = useRef<HTMLDivElement>(null);
  // After Move up / Move down the row itself takes focus, like upstream's movePinned.
  const focusRowAfterClose = useRef(false);
  const onOpenChangeComplete = (open: boolean) => {
    renameAfterClose.onOpenChangeComplete(open);
    newGroupAfterClose.onOpenChangeComplete(open);
    if (open || !focusRowAfterClose.current) return;
    focusRowAfterClose.current = false;
    rowRef.current?.querySelector<HTMLElement>("[data-row-main-button]")?.focus();
  };
  const finalFocus = () =>
    renameAfterClose.finalFocus() && newGroupAfterClose.finalFocus() && !focusRowAfterClose.current;
  const pinnedRow: PinnedRowContext | undefined =
    pinnedIds === undefined
      ? undefined
      : {
          pinnedIds,
          onMoved: () => {
            focusRowAfterClose.current = true;
          },
        };
  return (
    <RowRenameContext.Provider
      value={{ rename, requestRename, requestNewGroup: newGroupAfterClose.requestRename }}
    >
      <div ref={rowRef} className={`group/session-row relative ${className ?? ""}`}>
        <ContextMenu onOpenChangeComplete={onOpenChangeComplete}>
          <ContextMenuTrigger>{children}</ContextMenuTrigger>
          <MenuContent finalFocus={finalFocus}>
            <SessionMenuBody session={session} pinnedRow={pinnedRow} />
          </MenuContent>
        </ContextMenu>
        <Menu onOpenChangeComplete={onOpenChangeComplete}>
          <MenuTrigger
            aria-label={`More options for ${rename.title}`}
            data-row-action=""
            className={KEBAB_CLASS}
          >
            <Ellipsis aria-hidden="true" className="size-4" />
          </MenuTrigger>
          <MenuContent align="end" finalFocus={finalFocus}>
            <SessionMenuBody session={session} pinnedRow={pinnedRow} />
          </MenuContent>
        </Menu>
      </div>
      <NewGroupDialog
        open={newGroupOpen}
        onOpenChange={setNewGroupOpen}
        switchesGroupBy={listPrefs.groupBy !== "custom"}
        onCreate={createGroupWithRow}
      />
    </RowRenameContext.Provider>
  );
}
