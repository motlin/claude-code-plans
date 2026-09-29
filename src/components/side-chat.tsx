import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  GitBranch,
  PanelRight,
  PictureInPicture2,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useShortcut, useShortcutKeys } from "../hooks/use-shortcut";
import { writeClipboardText } from "../lib/clipboard";
import { parseBtwCommand } from "../lib/side-chat";
import {
  askSideChat,
  branchSideChatEntry,
  clearSideChat,
  closeSideChat,
  openSideChat,
  type SideChatEntry,
  setSideChatMode,
  stopEntry,
  toggleSideChat,
  useSideChat,
} from "../lib/side-chat-store";
import { MarkdownArticle } from "./markdown-article";
import { type PaneChrome, registerPane } from "./panes/pane-registry";
import { useOptionalPaneHost } from "./panes/tile-host";
import { type ToastOptions, useToast } from "./toast";
import { Shortcut } from "./ui/shortcut";
import { Tooltip } from "./ui/tooltip";
import { ViewportPortal } from "./viewport-portal";

const ASIDE_CLASS =
  "fixed right-4 bottom-4 z-40 flex w-[400px] max-w-[calc(100vw-2rem)] max-h-[min(560px,calc(100vh-2rem))] origin-bottom-right scale-95 flex-col overflow-hidden rounded-card border-[0.5px] border-strong bg-surface-3 opacity-0 shadow-[0_24px_60px_color-mix(in_srgb,black_18%,transparent),0_4px_16px_color-mix(in_srgb,black_8%,transparent)] transition-[opacity,transform] duration-200 ease-out data-[open]:scale-100 data-[open]:opacity-100";

const ICON_BUTTON_CLASS =
  "flex size-6 shrink-0 items-center justify-center rounded-r5 text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-primary focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40";

const ANSWER_ACTION_CLASS =
  "flex items-center gap-1 rounded-r5 px-1.5 py-0.5 text-caption text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-primary disabled:pointer-events-none disabled:opacity-40";

const SECONDARY_PANE_MESSAGE = "Side chat is only available in the primary pane.";

/**
 * Whether keyboard focus sits inside a tile-host pane rather than the main
 * chat. The docked side chat's own pane does not count.
 */
function focusInSecondaryPane(): boolean {
  const pane = document.activeElement?.closest<HTMLElement>("[data-pane-root]");
  return pane != null && pane.dataset["paneKind"] !== "side-chat";
}

/**
 * ⌘; on a session page. Declines the key (so other handlers may claim it)
 * when the session is not found, and refuses with a toast when focus is in a
 * secondary pane, as upstream does.
 */
export function useSideChatShortcut(sessionId: string, available: boolean): void {
  const toast = useToast();
  useShortcut("toggle_side_chat", () => {
    if (!available) return false;
    if (focusInSecondaryPane()) {
      toast({ kind: "error", message: SECONDARY_PANE_MESSAGE });
      return true;
    }
    toggleSideChat(sessionId);
    return true;
  });
}

const NOT_STARTED_MESSAGE =
  "Side chat is available once this session starts. Send your first message to start it.";

/**
 * The composer's `/btw` interception, run before a prompt is sent. Returns
 * true when the prompt was a `/btw` command and must not reach the session.
 */
export function handleBtwPrompt(
  prompt: string,
  {
    sessionId,
    messageCount,
    toast,
  }: { sessionId: string; messageCount: number; toast: (options: ToastOptions) => void },
): boolean {
  const command = parseBtwCommand(prompt);
  if (command === null) return false;
  if (messageCount === 0) {
    toast({ kind: "error", message: NOT_STARTED_MESSAGE });
    return true;
  }
  openSideChat(sessionId);
  if (command.question !== "") void askSideChat(sessionId, command.question);
  return true;
}

const POPOUT_BLOCKED_MESSAGE = "Couldn’t open a new window. Allow pop-ups for this site.";

/**
 * claude.ai/code's side chat for quick questions about this session. Each
 * question runs as an ephemeral fork, so nothing is added to the session
 * itself. It shows as a floating card, docks as the `side-chat` pane when a
 * pane host is present, or pops out to its own window; the Q/A thread lives
 * in the side chat store, so it survives every switch.
 */
export function SideChat({ sessionId, messageCount }: { sessionId: string; messageCount: number }) {
  const { open, mode } = useSideChat(sessionId);
  const host = useOptionalPaneHost();
  const canDock = host !== null;
  const floating = mode === "floating" || (mode === "docked" && !canDock);
  const floatingOpen = open && floating;
  const popoutRoot = usePopoutWindow(sessionId, open && mode === "popout");
  useDockedSideChat(sessionId, messageCount, open && mode === "docked");

  return (
    <>
      <ViewportPortal>
        <aside
          aria-label="Side chat"
          data-focus-region="side-chat"
          data-open={floatingOpen ? "" : undefined}
          aria-hidden={floatingOpen ? undefined : true}
          inert={!floatingOpen}
          className={ASIDE_CLASS}
        >
          {floating && (
            <SideChatPanel
              sessionId={sessionId}
              messageCount={messageCount}
              variant="floating"
              active={floatingOpen}
              canDock={canDock}
            />
          )}
        </aside>
      </ViewportPortal>
      {popoutRoot !== null &&
        createPortal(
          <SideChatPanel
            sessionId={sessionId}
            messageCount={messageCount}
            variant="popout"
            active
            canDock={false}
          />,
          popoutRoot,
        )}
    </>
  );
}

/**
 * Registers the `side-chat` pane kind while a pane host is present, and keeps
 * the pane open exactly while the side chat is open and docked: docking opens
 * it, undocking or closing the side chat closes it, and closing the pane from
 * the host (⌘\) closes the side chat.
 */
function useDockedSideChat(sessionId: string, messageCount: number, docked: boolean): void {
  const host = useOptionalPaneHost();
  const hasHost = host !== null;

  useEffect(() => {
    if (!hasHost) return undefined;
    return registerPane("side-chat", {
      title: "Side chat",
      header: "custom",
      render: (chrome) => (
        <SideChatPanel
          sessionId={sessionId}
          messageCount={messageCount}
          variant="docked"
          active
          canDock
          chrome={chrome}
        />
      ),
    });
  }, [hasHost, sessionId, messageCount]);

  const paneOpen = host?.isOpen("side-chat") ?? false;
  const wasPaneOpen = useRef(paneOpen);
  useEffect(() => {
    if (host === null) return;
    const closedByHost = wasPaneOpen.current && !paneOpen;
    wasPaneOpen.current = paneOpen;
    if (closedByHost && docked) closeSideChat(sessionId);
    else if (docked && !paneOpen) host.openPane("side-chat");
    else if (!docked && paneOpen) host.closePane("side-chat");
  }, [host, paneOpen, docked, sessionId]);
}

/** Copies the page's stylesheets and theme onto a pop-out window's document. */
function adoptPageStyles(target: Document): void {
  for (const node of document.head.querySelectorAll("style, link[rel='stylesheet']")) {
    const clone = node.cloneNode(true);
    if (node instanceof HTMLLinkElement && clone instanceof HTMLLinkElement) clone.href = node.href;
    target.head.append(clone);
  }
  for (const { name, value } of document.documentElement.attributes) {
    if (name === "class" || name === "style" || name.startsWith("data-")) {
      target.documentElement.setAttribute(name, value);
    }
  }
  target.body.className = "m-0 bg-surface-3 text-primary";
}

/**
 * Opens the side chat's pop-out window while `active` and returns the element
 * to portal into. The window closing on its own drops back to the floating
 * card; a blocked pop-up does too, with a toast.
 */
function usePopoutWindow(sessionId: string, active: boolean): HTMLElement | null {
  const toast = useToast();
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const popup = window.open("", `side-chat-${sessionId}`, "popup,width=420,height=640");
    if (popup === null) {
      setSideChatMode(sessionId, "floating");
      toast({ kind: "error", message: POPOUT_BLOCKED_MESSAGE });
      return undefined;
    }
    popup.document.title = "Side chat";
    adoptPageStyles(popup.document);
    const container = popup.document.createElement("div");
    container.className = "flex h-dvh flex-col";
    popup.document.body.append(container);
    const onPageHide = () => setSideChatMode(sessionId, "floating");
    popup.addEventListener("pagehide", onPageHide);
    setRoot(container);
    return () => {
      popup.removeEventListener("pagehide", onPageHide);
      setRoot(null);
      container.remove();
      popup.close();
    };
  }, [active, sessionId, toast]);

  return root;
}

type SideChatVariant = "floating" | "docked" | "popout";

/** The side chat's header, context strip, Q/A thread and input, shared by every variant. */
function SideChatPanel({
  sessionId,
  messageCount,
  variant,
  active,
  canDock,
  chrome,
}: {
  sessionId: string;
  messageCount: number;
  variant: SideChatVariant;
  /** Visible and interactive; the input takes focus when this turns on. */
  active: boolean;
  canDock: boolean;
  chrome?: PaneChrome;
}) {
  const { entries } = useSideChat(sessionId);
  const shortcut = useShortcutKeys("toggle_side_chat");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [draft, setDraft] = useState("");
  const pending = entries.some((entry) => entry.status === "pending");
  const lastEntry = entries.at(-1);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  useEffect(() => {
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [lastEntry?.answer, entries.length]);

  function send() {
    const question = draft.trim();
    if (question === "" || pending) return;
    setDraft("");
    void askSideChat(sessionId, question);
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        closeSideChat(sessionId);
      }}
    >
      <header className="relative flex items-center gap-1 border-b-[0.5px] border-strong px-3 py-2">
        {chrome?.moveHandle}
        <h2 className="flex-1 truncate text-body font-medium text-primary">Side chat</h2>
        {variant !== "popout" && <Shortcut keys={shortcut.keys} className="mr-1" />}
        {entries.length > 0 && (
          <HeaderButton label="Clear side chat" onClick={() => clearSideChat(sessionId)}>
            <Trash2 className="size-3.5" aria-hidden="true" />
          </HeaderButton>
        )}
        {variant === "floating" && canDock && (
          <HeaderButton label="Dock side chat" onClick={() => setSideChatMode(sessionId, "docked")}>
            <PanelRight className="size-3.5" aria-hidden="true" />
          </HeaderButton>
        )}
        {variant === "docked" && (
          <HeaderButton
            label="Undock side chat"
            onClick={() => setSideChatMode(sessionId, "floating")}
          >
            <PictureInPicture2 className="size-3.5" aria-hidden="true" />
          </HeaderButton>
        )}
        {variant !== "popout" && (
          <HeaderButton
            label="Open in new window"
            onClick={() => setSideChatMode(sessionId, "popout")}
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </HeaderButton>
        )}
        <HeaderButton
          label="Close side chat"
          ariaKeyShortcuts={variant === "popout" ? undefined : shortcut.ariaKeyShortcuts}
          onClick={() => closeSideChat(sessionId)}
        >
          <X className="size-4" aria-hidden="true" />
        </HeaderButton>
      </header>
      <p className="border-b-[0.5px] border-strong px-3 py-1.5 text-caption text-t6">
        Sees {messageCount} messages from main chat · read-only
      </p>
      {entries.length > 0 ? (
        <ol ref={listRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
          {entries.map((entry) => (
            <SideChatItem key={entry.id} sessionId={sessionId} entry={entry} />
          ))}
        </ol>
      ) : (
        variant !== "floating" && <div className="flex-1" />
      )}
      <div className="flex items-end gap-1 border-t-[0.5px] border-strong p-2">
        <textarea
          ref={inputRef}
          aria-label="Side chat question"
          value={draft}
          rows={1}
          placeholder={entries.length > 0 ? "Follow up…" : "Ask a quick question…"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          className="block max-h-40 min-h-6 w-full resize-none bg-transparent px-1 py-0.5 text-body text-primary [field-sizing:content] placeholder:text-t6 focus:outline-none pointer-coarse:text-[16px]"
        />
        {pending ? (
          <Tooltip content="Stop">
            <button
              type="button"
              aria-label="Stop"
              className={ICON_BUTTON_CLASS}
              onClick={() => {
                if (lastEntry !== undefined) void stopEntry(sessionId, lastEntry.id);
              }}
            >
              <Square className="size-3" fill="currentColor" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : (
          <Tooltip content="Send" shortcut="enter">
            <button
              type="button"
              aria-label="Send"
              className={ICON_BUTTON_CLASS}
              disabled={draft.trim() === ""}
              onClick={send}
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function HeaderButton({
  label,
  ariaKeyShortcuts,
  onClick,
  children,
}: {
  label: string;
  ariaKeyShortcuts?: string | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-keyshortcuts={ariaKeyShortcuts}
        className={ICON_BUTTON_CLASS}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function pendingLabel(entry: SideChatEntry): string {
  if (entry.stopping === true) return "Stopping…";
  return entry.activity ?? "Thinking…";
}

function SideChatItem({ sessionId, entry }: { sessionId: string; entry: SideChatEntry }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (await writeClipboardText(entry.answer)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  async function branch() {
    try {
      const forkedId = await branchSideChatEntry(sessionId, entry.id);
      if (forkedId === null) {
        toast({ kind: "error", message: "Couldn’t branch to a new chat." });
        return;
      }
      void navigate({ to: "/session/$id", params: { id: forkedId } });
    } catch (err) {
      toast({
        kind: "error",
        message: "Couldn’t branch to a new chat.",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <li className="flex flex-col gap-1.5">
      <div className="self-end max-w-[85%] rounded-r7 bg-user-msg-bg px-3 py-1.5 text-body whitespace-pre-wrap break-words text-user-msg-text">
        {entry.question}
      </div>
      {entry.answer !== "" && (
        <div className="min-w-0 text-body break-words text-primary">
          <MarkdownArticle markdown={entry.answer} typographer />
        </div>
      )}
      {entry.status === "pending" && (
        <div className="flex items-center gap-2 text-caption text-t6">
          <span
            className="inline-block size-1.5 animate-pulse rounded-full bg-accent-100"
            aria-hidden="true"
          />
          {pendingLabel(entry)}
        </div>
      )}
      {entry.status === "error" && entry.error !== undefined && (
        <p role="alert" className="text-caption text-danger-000">
          {entry.error}
        </p>
      )}
      {entry.status === "done" && (
        <div className="flex items-center gap-1">
          {entry.branching === true ? (
            <span className="px-1.5 text-caption text-t6">Forking session…</span>
          ) : (
            <>
              <button
                type="button"
                aria-label="Copy answer"
                className={ANSWER_ACTION_CLASS}
                onClick={() => void copy()}
              >
                {copied ? (
                  <Check className="size-3" aria-hidden="true" />
                ) : (
                  <Copy className="size-3" aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                aria-label="Branch to new chat"
                className={ANSWER_ACTION_CLASS}
                onClick={() => void branch()}
              >
                <GitBranch className="size-3" aria-hidden="true" />
                Branch
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
