import { Ellipsis } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef } from "react";

import { useToggleSessionStar } from "../lib/api/sessions";
import { assertNever } from "../lib/assert-never";
import { writeClipboardText } from "../lib/clipboard";
import { relativeBucket } from "../lib/search-text";
import {
  getSessionMenuItems,
  type SessionMenuCapability,
  type SessionMenuItemId,
  type SessionMenuReadState,
} from "../lib/session-menu-items";
import type { SessionBucket } from "../lib/session-state";
import { markSeen, markUnseen } from "../lib/unread-store";
import { useHasUnseenWork } from "./session-unread-control";
import { useToast } from "./toast";
import { Shortcut } from "./ui/shortcut";

/** A session row the → card can act on; `starred`/`bucket` are unknown for server-only hits. */
export interface PaletteCardSession {
  id: string;
  title: string;
  mtime: string;
  starred: boolean | undefined;
  bucket: SessionBucket | undefined;
}

type CardItemId = "open" | "open-new-tab" | SessionMenuItemId;

interface CardItem {
  id: CardItemId;
  label: string;
}

function readStateOf(bucket: SessionBucket | undefined, unseen: boolean): SessionMenuReadState {
  if (bucket === "working") return "working";
  if (bucket === "blocked") return "awaiting";
  return unseen ? "unread" : "read";
}

function sessionUrl(id: string): string {
  return `${window.location.origin}/session/${encodeURIComponent(id)}`;
}

export async function copySessionLink(
  id: string,
  toast: ReturnType<typeof useToast>,
): Promise<void> {
  const copied = await writeClipboardText(sessionUrl(id));
  toast(
    copied
      ? { kind: "success", message: "Link copied to clipboard." }
      : { kind: "error", message: "Couldn’t copy the link. Try again." },
  );
}

/**
 * The claude.ai/code ⌘K row-actions card: a 280px menu beside the palette with
 * the session title, "Session · <bucket>" and items numbered 1…N. ← or Esc
 * closes only the card; Delete is never offered (transcripts are never deleted).
 */
export function PaletteRowActionsCard({
  session,
  top,
  onOpen,
  onClose,
}: {
  session: PaletteCardSession;
  top: number;
  onOpen: (id: string) => void;
  onClose: (options: { refocus: boolean }) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const unseen = useHasUnseenWork(session.id);
  const star = useToggleSessionStar(session.id);
  const toast = useToast();

  const capabilities = new Set<SessionMenuCapability>(["readState", "copyLink"]);
  if (session.starred !== undefined) capabilities.add("pin");
  const sessionItems = getSessionMenuItems(
    {
      title: session.title,
      pinned: session.starred ?? false,
      readState: readStateOf(session.bucket, unseen),
      archived: false,
      prUrl: null,
      hasLivePane: false,
      forkDisabledReason: null,
    },
    capabilities,
    { surface: "palette-card" },
  ).flatMap((entry): CardItem[] => (entry.kind === "item" ? [entry] : []));
  const items: CardItem[] = [
    { id: "open", label: "Open" },
    { id: "open-new-tab", label: "Open in new tab" },
    ...sessionItems,
  ];

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  const run = (id: CardItemId): void => {
    if (id === "open") {
      onOpen(session.id);
      return;
    }
    onClose({ refocus: true });
    switch (id) {
      case "open-new-tab":
        window.open(sessionUrl(session.id), "_blank", "noopener,noreferrer");
        return;
      case "copy-link":
        void copySessionLink(session.id, toast);
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
      case "open-in":
      case "open-live-terminal":
      case "open-pr":
      case "mark-completed":
      case "rename":
      case "fork":
      case "archive":
      case "unarchive":
        return;
      default:
        assertNever(id);
    }
  };

  function moveFocus(event: KeyboardEvent<HTMLDivElement>, delta: number | "first" | "last") {
    const elements = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ];
    const current = elements.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (delta === "first") next = 0;
    else if (delta === "last") next = elements.length - 1;
    else next = (current + delta + elements.length) % elements.length;
    elements[next]?.focus();
    event.preventDefault();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const numbered = /^[1-9]$/.test(event.key) ? items[Number(event.key) - 1] : undefined;
    if (numbered !== undefined) {
      event.preventDefault();
      run(numbered.id);
      return;
    }
    switch (event.key) {
      case "ArrowLeft":
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose({ refocus: true });
        return;
      case "ArrowDown":
        moveFocus(event, 1);
        return;
      case "ArrowUp":
        moveFocus(event, -1);
        return;
      case "Home":
        moveFocus(event, "first");
        return;
      case "End":
        moveFocus(event, "last");
        return;
      case "Tab":
        event.preventDefault();
        return;
      case "Enter":
      case " ": {
        const id = (document.activeElement as HTMLElement | null)?.dataset["cardItem"];
        const item = items.find((candidate) => candidate.id === id);
        if (item !== undefined) {
          event.preventDefault();
          run(item.id);
        }
        return;
      }
      default:
    }
  }

  const bucket = relativeBucket(Date.parse(session.mtime), Date.now());

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
      aria-label="Actions"
      data-palette-row-actions=""
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose({ refocus: false });
      }}
      style={{ top }}
      className="absolute right-2 z-10 flex max-h-[calc(100vh-2rem)] w-[280px] flex-col overflow-hidden rounded-xl border-[0.5px] border-strong bg-surface-3 text-sm text-primary shadow-2xl outline-none animate-in fade-in slide-in-from-left-3 duration-150 motion-reduce:animate-none lg:right-auto lg:left-[calc(100%+0.5rem)]"
    >
      <div className="flex shrink-0 flex-col gap-0.5 px-3.5 pt-2 pb-1">
        <div data-palette-card-title="" className="line-clamp-2 break-words">
          {session.title}
        </div>
        <div data-palette-card-meta="" className="truncate text-xs text-ink-muted">
          {bucket === null ? "Session" : `Session · ${bucket}`}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1 pt-0">
        <div role="separator" className="mx-2.5 my-1 h-px bg-border" />
        {items.map((item, index) => (
          <div
            key={item.id}
            role="menuitem"
            tabIndex={-1}
            data-card-item={item.id}
            aria-keyshortcuts={String(index + 1)}
            onClick={() => run(item.id)}
            onMouseMove={(event) => event.currentTarget.focus()}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 outline-none select-none hover:bg-fill-ghost-hover focus:bg-fill-ghost-hover"
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="ml-3 flex shrink-0 items-center text-ink-muted">
              <Shortcut keys={String(index + 1)} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Upstream's hover "…" beside a session row; hidden from AT, which uses → instead. */
export function PaletteRowActionsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 right-9 flex items-center opacity-0 group-hover/palette-row:opacity-100 peer-data-[selected=true]:opacity-100 pointer-coarse:hidden *:pointer-events-auto"
    >
      <button
        type="button"
        aria-label="Actions"
        tabIndex={-1}
        data-palette-row-actions-button=""
        onMouseDown={(event) => event.preventDefault()}
        onClick={onOpen}
        className="flex size-6 items-center justify-center rounded-r6 text-ink-muted transition-colors hover:bg-fill-ghost-hover hover:text-primary"
      >
        <Ellipsis aria-hidden="true" className="size-4" />
      </button>
    </span>
  );
}
