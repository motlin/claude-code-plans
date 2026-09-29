import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Ellipsis } from "lucide-react";
import { createContext, type ReactNode, useContext, useRef } from "react";

import { herdrPanesQueryOptions } from "../lib/api/herdr";
import { useToggleSessionStar, type SessionListItem } from "../lib/api/sessions";
import { assertNever } from "../lib/assert-never";
import { writeClipboardText } from "../lib/clipboard";
import { useSessionArchive } from "../hooks/use-session-archive";
import { type SessionRename, useSessionRename } from "../hooks/use-session-rename";
import {
  getSessionMenuItems,
  type SessionMenuCapability,
  type SessionMenuEntry,
  type SessionMenuItemId,
  type SessionMenuReadState,
  type SessionMenuSession,
} from "../lib/session-menu-items";
import { markSeen, markUnseen } from "../lib/unread-store";
import { InlineRenameInput } from "./inline-rename-input";
import { useHasUnseenWork } from "./session-unread-control";
import { useToast } from "./toast";
import {
  ContextMenu,
  ContextMenuTrigger,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";

/** Actions wired locally so far; the rest appear as their features land. */
const LOCAL_CAPABILITIES: ReadonlySet<SessionMenuCapability> = new Set<SessionMenuCapability>([
  "openLiveTerminal",
  "pin",
  "readState",
  "rename",
  "copyLink",
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

function readStateOf(session: SessionListItem, unseen: boolean): SessionMenuReadState {
  if (session.bucket === "working") return "working";
  if (session.bucket === "blocked") return "awaiting";
  return unseen ? "unread" : "read";
}

function useSessionMenu(session: SessionListItem) {
  const unseen = useHasUnseenWork(session.id);
  const { data: herdr } = useQuery(herdrPanesQueryOptions);
  const star = useToggleSessionStar(session.id);
  const toast = useToast();
  const setArchived = useSessionArchive(session.id);
  const navigate = useNavigate();
  const { requestRename } = useRowRename();

  const menuSession: SessionMenuSession = {
    title: session.title,
    pinned: session.starred,
    readState: readStateOf(session, unseen),
    archived: session.archived,
    prUrl: null,
    hasLivePane: herdr?.panes.some((pane) => pane.sessionId === session.id) ?? false,
    forkDisabledReason: null,
  };

  const copyLink = async () => {
    const link = `${window.location.origin}/session/${encodeURIComponent(session.id)}`;
    const copied = await writeClipboardText(link);
    toast(
      copied
        ? { kind: "success", message: "Link copied to clipboard." }
        : { kind: "error", message: "Couldn’t copy the link. Try again." },
    );
  };

  const run = (id: SessionMenuItemId): void => {
    switch (id) {
      case "open-live-terminal":
        void navigate({ to: "/herdr/terminal/$sessionId", params: { sessionId: session.id } });
        return;
      case "pin":
      case "unpin":
        star.mutate(id === "pin");
        return;
      case "mark-read":
        markSeen(session.id);
        return;
      case "mark-unread":
        markUnseen(session.id);
        return;
      case "copy-link":
        void copyLink();
        return;
      case "rename":
        requestRename();
        return;
      case "archive":
      case "unarchive":
        setArchived(id === "archive");
        return;
      case "open-in":
      case "open-pr":
      case "mark-completed":
      case "fork":
        return;
      default:
        assertNever(id);
    }
  };

  return {
    entries: getSessionMenuItems(menuSession, LOCAL_CAPABILITIES, { surface: "row" }),
    run,
  };
}

function MenuEntries({
  entries,
  run,
}: {
  entries: SessionMenuEntry[];
  run: (id: SessionMenuItemId) => void;
}) {
  return entries.map((entry, index) => {
    if (entry.kind === "separator") return <MenuSeparator key={`separator-${index}`} />;
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
  // The open menu holds focus, so the input may only mount (and take focus)
  // once it has closed; the closing menu must not hand focus back either.
  const renameAfterClose = useRef(false);
  const requestRename = () => {
    renameAfterClose.current = true;
  };
  const onOpenChangeComplete = (open: boolean) => {
    if (open || !renameAfterClose.current) return;
    renameAfterClose.current = false;
    rename.startEditing();
  };
  const finalFocus = () => !renameAfterClose.current;
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
