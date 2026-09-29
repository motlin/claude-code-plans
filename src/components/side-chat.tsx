import { useNavigate } from "@tanstack/react-router";
import { ArrowUp, Check, Copy, GitBranch, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  stopEntry,
  toggleSideChat,
  useSideChat,
} from "../lib/side-chat-store";
import { MarkdownArticle } from "./markdown-article";
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

/** Whether keyboard focus sits inside a tile-host pane rather than the main chat. */
function focusInSecondaryPane(): boolean {
  return document.activeElement?.closest("[data-pane-root]") != null;
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

/**
 * claude.ai/code's side chat: a floating card for quick questions about this
 * session. Each question runs as an ephemeral fork, so nothing is added to
 * the session itself.
 */
export function SideChat({ sessionId, messageCount }: { sessionId: string; messageCount: number }) {
  const { open, entries } = useSideChat(sessionId);
  const shortcut = useShortcutKeys("toggle_side_chat");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [draft, setDraft] = useState("");
  const pending = entries.some((entry) => entry.status === "pending");
  const lastEntry = entries.at(-1);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

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
    <ViewportPortal>
      <aside
        aria-label="Side chat"
        data-focus-region="side-chat"
        data-open={open ? "" : undefined}
        aria-hidden={open ? undefined : true}
        inert={!open}
        className={ASIDE_CLASS}
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          closeSideChat(sessionId);
        }}
      >
        <header className="flex items-center gap-1 border-b-[0.5px] border-strong px-3 py-2">
          <h2 className="flex-1 truncate text-body font-medium text-primary">Side chat</h2>
          <Shortcut keys={shortcut.keys} className="mr-1" />
          {entries.length > 0 && (
            <Tooltip content="Clear side chat" side="bottom">
              <button
                type="button"
                aria-label="Clear side chat"
                className={ICON_BUTTON_CLASS}
                onClick={() => clearSideChat(sessionId)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Close side chat" side="bottom">
            <button
              type="button"
              aria-label="Close side chat"
              aria-keyshortcuts={shortcut.ariaKeyShortcuts}
              className={ICON_BUTTON_CLASS}
              onClick={() => closeSideChat(sessionId)}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </header>
        <p className="border-b-[0.5px] border-strong px-3 py-1.5 text-caption text-t6">
          Sees {messageCount} messages from main chat · read-only
        </p>
        {entries.length > 0 && (
          <ol ref={listRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
            {entries.map((entry) => (
              <SideChatItem key={entry.id} sessionId={sessionId} entry={entry} />
            ))}
          </ol>
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
      </aside>
    </ViewportPortal>
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
