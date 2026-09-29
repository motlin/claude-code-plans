import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { CornerDownLeft, MessageSquare, Square, X } from "lucide-react";

import { useComposerDraft } from "../hooks/use-composer-draft";
import { useFileMentionSuggestions } from "../hooks/use-file-mention-suggestions";
import type { LiveLaunchControls } from "../hooks/use-live-launch-options";
import { useShortcut } from "../hooks/use-shortcut";
import type { ComposerState } from "../lib/composer-state";
import {
  appendAttachment,
  onAttachContextRequest,
  prependReviewComments,
} from "../lib/context-attach";
import {
  type QueuedDiffComment,
  removeQueuedDiffComment,
  takeQueuedDiffComments,
  useDiffComments,
} from "../lib/diff-comments";
import type { SessionFilesEntry } from "../lib/api/session-files";
import { fileMentionTrigger, insertFileMention } from "../lib/file-mentions";
import type { LaunchOptions } from "../lib/launch-options";
import {
  filterSlashCommands,
  type SlashCommand,
  slashArgumentHint,
  slashQuery,
} from "../lib/slash-commands";
import { ComposerChin } from "./composer-chin";
import type { ChinMenu } from "./composer-launch-menus";
import { FileMentionMenu, fileMentionOptionId } from "./file-mention-menu";
import { SlashCommandMenu, slashCommandOptionId } from "./slash-command-menu";
import { Tooltip } from "./ui/tooltip";

type ComposerVariant = "session" | "home";

const PLACEHOLDER: Record<ComposerVariant, string> = {
  session: "Type / for commands",
  home: "Describe a task or ask a question",
};

const CARD_CLASS =
  "relative z-[1] flex cursor-text flex-col gap-y-1.5 rounded-card bg-surface-3 p-2 shadow-[var(--composer-shadow)] transition-shadow hover:shadow-[var(--composer-shadow-hover)] focus-within:shadow-[var(--composer-shadow-focus)]";

const EDITOR_CLASS =
  "block w-full resize-none overflow-y-auto bg-transparent py-0.5 pl-1 font-sans text-[14px]/[20px] text-primary [field-sizing:content] placeholder:text-[rgb(137,135,129)] focus:outline-none disabled:opacity-50 pointer-coarse:text-[16px]";

const ICON_BUTTON_CLASS =
  "flex aspect-square size-6 items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40";

function chipLabel({ path, line, endLine }: QueuedDiffComment): string {
  const name = path.slice(path.lastIndexOf("/") + 1) || path;
  return `${name}:${endLine === undefined || endLine === line ? line : `${line}-${endLine}`}`;
}

/** Changes pane comments waiting for the next prompt, as removable chips above the card. */
function QueuedCommentChips({
  sessionId,
  comments,
}: {
  sessionId: string;
  comments: readonly QueuedDiffComment[];
}) {
  return (
    <ul aria-label="Queued comments" className="mb-1.5 flex flex-wrap gap-1">
      {comments.map((comment) => {
        const label = chipLabel(comment);
        return (
          <li
            key={comment.id}
            title={comment.text}
            className="flex h-6 max-w-[16rem] min-w-0 items-center gap-1 rounded-r6 border border-border bg-surface-3 ps-1.5 pe-0.5 text-footnote text-secondary"
          >
            <MessageSquare aria-hidden="true" className="size-3 shrink-0" />
            <span className="shrink-0 text-primary">{label}</span>
            <span className="min-w-0 truncate">{comment.text}</span>
            <button
              type="button"
              aria-label={`Remove comment on ${label}`}
              onClick={() => removeQueuedDiffComment(sessionId, comment.id)}
              className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-r5 hover:bg-fill-ghost-hover hover:text-primary"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface ComposerProps {
  variant: ComposerVariant;
  /** Draft storage key: the session id, or `"home"` for the new-session composer. */
  draftKey: string;
  /** `launchOptions` holds the chin's mode / model / effort picks for a fork or launch. */
  onSend: (prompt: string, launchOptions: LaunchOptions) => void;
  onCancel?: () => void;
  isStreaming?: boolean;
  /** While a live session is working, the send slot becomes Stop response. */
  onStop?: (() => void) | undefined;
  disabled?: boolean;
  deliveryHint?: string | undefined;
  /** Mode / model / effort / usage readouts; the chin stays empty without them. */
  chin?: ComposerState | undefined;
  /** Entries for the "/" autocomplete popup (`GET /api/commands`). */
  slashCommands?: readonly SlashCommand[] | undefined;
  /** Settings allow launching in Bypass permissions mode. */
  bypassPermissionsAllowed?: boolean | undefined;
  /** An idle live pane: chin picks steer it instead of becoming launch flags. */
  live?: LiveLaunchControls | undefined;
  /** The session whose working directory feeds the "@" file mention popup. */
  mentionSessionId?: string | undefined;
}

const NO_COMMANDS: readonly SlashCommand[] = [];

/**
 * The claude.ai/code ChatComposer card: an auto-growing prompt editor with a
 * trailing icon Send button and a chin row of readouts beneath.
 */
export function Composer({
  variant,
  draftKey,
  onSend,
  onCancel,
  isStreaming = false,
  onStop,
  disabled = false,
  deliveryHint,
  chin,
  slashCommands = NO_COMMANDS,
  bypassPermissionsAllowed = false,
  live,
  mentionSessionId,
}: ComposerProps) {
  const { text: prompt, setText: setPrompt, clear: clearDraft } = useComposerDraft(draftKey);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const slashMenuId = useId();
  const mentionMenuId = useId();
  const [caret, setCaret] = useState(0);
  const pendingCaretRef = useRef<number | null>(null);
  const { queued: queuedComments } = useDiffComments(draftKey);
  const canSend = (prompt.trim() !== "" || queuedComments.length > 0) && !isStreaming && !disabled;
  const [launch, setLaunch] = useState<{ draftKey: string; options: LaunchOptions }>({
    draftKey,
    options: {},
  });
  const launchOptions = launch.draftKey === draftKey ? launch.options : {};
  const [openMenu, setOpenMenu] = useState<ChinMenu | null>(null);
  const menuShortcutOptions = { disabled: chin === undefined };
  useShortcut("open_mode_menu", () => setOpenMenu("mode"), menuShortcutOptions);
  useShortcut("open_model_menu", () => setOpenMenu("model"), menuShortcutOptions);
  useShortcut("open_effort_selector", () => setOpenMenu("effort"), menuShortcutOptions);

  useEffect(() => {
    if (!isStreaming) textareaRef.current?.focus();
  }, [isStreaming]);

  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  useEffect(
    () =>
      onAttachContextRequest(draftKey, (snippet) => {
        const next = appendAttachment(promptRef.current, snippet);
        promptRef.current = next;
        setPrompt(next);
        textareaRef.current?.focus();
      }),
    [draftKey, setPrompt],
  );

  const query = slashQuery(prompt);
  const [dismissedPrompt, setDismissedPrompt] = useState<string | null>(null);
  const [highlight, setHighlight] = useState({ query: "", index: 0 });
  const matches =
    query === null || dismissedPrompt === prompt ? [] : filterSlashCommands(slashCommands, query);
  const slashOpen = query !== null && matches.length > 0;
  const highlighted = highlight.query === query ? Math.min(highlight.index, matches.length - 1) : 0;
  const argumentHint = slashArgumentHint(slashCommands, prompt);

  const trigger =
    mentionSessionId === undefined || slashOpen ? null : fileMentionTrigger(prompt, caret);
  const mentionKey = trigger === null ? null : `${trigger.start}\0${prompt}`;
  const [dismissedMention, setDismissedMention] = useState<string | null>(null);
  const mention = mentionKey === dismissedMention ? null : trigger;
  const suggestions = useFileMentionSuggestions(mentionSessionId, mention?.query ?? null);
  const mentionEntries = suggestions?.entries ?? [];
  const mentionOpen = mention !== null && mentionEntries.length > 0;
  const [mentionHighlight, setMentionHighlight] = useState<{
    entries: readonly SessionFilesEntry[];
    index: number;
  }>({ entries: [], index: 0 });
  const mentionHighlighted =
    mentionHighlight.entries === mentionEntries
      ? Math.min(mentionHighlight.index, mentionEntries.length - 1)
      : 0;

  useLayoutEffect(() => {
    const next = pendingCaretRef.current;
    if (next === null) return;
    pendingCaretRef.current = null;
    textareaRef.current?.setSelectionRange(next, next);
  }, [prompt]);

  function acceptFileMention(entry: SessionFilesEntry) {
    if (mention === null) return;
    const next = insertFileMention(prompt, mention, caret, entry.relPath);
    pendingCaretRef.current = next.caret;
    setCaret(next.caret);
    setPrompt(next.text);
    textareaRef.current?.focus();
  }

  function handleMentionKey(e: React.KeyboardEvent): boolean {
    if (!mentionOpen) return false;
    const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (move !== 0) {
      setMentionHighlight({
        entries: mentionEntries,
        index: (mentionHighlighted + move + mentionEntries.length) % mentionEntries.length,
      });
    } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
      const entry = mentionEntries[mentionHighlighted];
      if (entry !== undefined) acceptFileMention(entry);
    } else if (e.key === "Escape") {
      setDismissedMention(mentionKey);
      e.stopPropagation();
    } else {
      return false;
    }
    e.preventDefault();
    return true;
  }

  function acceptSlashCommand(command: SlashCommand) {
    setPrompt(`/${command.name} `);
    textareaRef.current?.focus();
  }

  function handleSlashKey(e: React.KeyboardEvent): boolean {
    if (!slashOpen || query === null) return false;
    const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (move !== 0) {
      setHighlight({ query, index: (highlighted + move + matches.length) % matches.length });
    } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
      const command = matches[highlighted];
      if (command !== undefined) acceptSlashCommand(command);
    } else if (e.key === "Escape") {
      setDismissedPrompt(prompt);
      e.stopPropagation();
    } else {
      return false;
    }
    e.preventDefault();
    return true;
  }

  function handleSubmit() {
    if (!canSend) return;
    const trimmed = prompt.trim();
    // Slash commands run as typed; queued comments wait for the next real prompt.
    onSend(
      trimmed.startsWith("/")
        ? trimmed
        : prependReviewComments(trimmed, takeQueuedDiffComments(draftKey)),
      launchOptions,
    );
    clearDraft();
  }

  function insertSlash() {
    setPrompt(prompt.startsWith("/") ? prompt : `/${prompt}`);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing || handleSlashKey(e) || handleMentionKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div
      data-cds="ChatComposer"
      data-focus-region="composer"
      className="flex w-full min-w-0 flex-col font-sans"
    >
      {queuedComments.length > 0 && (
        <QueuedCommentChips sessionId={draftKey} comments={queuedComments} />
      )}
      <div className={CARD_CLASS} onClick={() => textareaRef.current?.focus()}>
        <div className="relative pr-[30px]">
          {slashOpen && query !== null && (
            <SlashCommandMenu
              id={slashMenuId}
              commands={matches}
              query={query}
              highlighted={highlighted}
              onHighlight={(index) => setHighlight({ query, index })}
              onAccept={acceptSlashCommand}
            />
          )}
          {mentionOpen && (
            <FileMentionMenu
              id={mentionMenuId}
              entries={mentionEntries}
              highlighted={mentionHighlighted}
              onHighlight={(index) => setMentionHighlight({ entries: mentionEntries, index })}
              onAccept={acceptFileMention}
            />
          )}
          {argumentHint !== null && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-[30px] left-0 overflow-hidden py-0.5 pl-1 font-sans text-[14px]/[20px] break-words whitespace-pre-wrap pointer-coarse:text-[16px]"
            >
              <span className="invisible">{prompt}</span>
              <span data-testid="slash-argument-hint" className="text-[rgb(137,135,129)]">
                {argumentHint}
              </span>
            </div>
          )}
          <textarea
            ref={textareaRef}
            aria-label="Prompt"
            data-focus-region-entry
            value={prompt}
            onChange={(e) => {
              setCaret(e.target.selectionStart);
              setPrompt(e.target.value);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={handleKeyDown}
            aria-controls={slashOpen ? slashMenuId : mentionOpen ? mentionMenuId : undefined}
            aria-activedescendant={
              slashOpen
                ? slashCommandOptionId(slashMenuId, highlighted)
                : mentionOpen
                  ? fileMentionOptionId(mentionMenuId, mentionHighlighted)
                  : undefined
            }
            placeholder={PLACEHOLDER[variant]}
            disabled={isStreaming || disabled}
            rows={1}
            enterKeyHint="enter"
            className={EDITOR_CLASS}
            style={{ minHeight: "24px", maxHeight: "min(24rem, 40svh)" }}
          />
          <div className="absolute right-0 bottom-0 flex min-h-6 items-center pl-1.5">
            {isStreaming || onStop !== undefined ? (
              <Tooltip content="Stop response" {...(isStreaming ? {} : { shortcut: "escape" })}>
                <button
                  type="button"
                  aria-label="Stop response"
                  onClick={isStreaming ? onCancel : onStop}
                  className={ICON_BUTTON_CLASS}
                >
                  <Square className="size-3.5" fill="currentColor" aria-hidden="true" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content="Send" shortcut="enter">
                <button
                  type="button"
                  aria-label="Send"
                  aria-describedby={deliveryHint ? hintId : undefined}
                  onClick={handleSubmit}
                  disabled={!canSend}
                  className={ICON_BUTTON_CLASS}
                >
                  <CornerDownLeft className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            )}
            {deliveryHint && (
              <span id={hintId} className="sr-only">
                {deliveryHint}
              </span>
            )}
          </div>
        </div>
      </div>
      <div
        data-cds="ChatComposerChin"
        className="mt-1.5 flex min-h-5 items-center justify-between ps-[7px] pe-2.5 text-[12px]/[15px] text-secondary"
      >
        {chin && (
          <ComposerChin
            state={chin}
            onInsertSlash={insertSlash}
            launch={{
              launchOptions: live?.options ?? launchOptions,
              onLaunchOptionsChange:
                live === undefined
                  ? (options) => setLaunch({ draftKey, options })
                  : (options) => void live.apply(options),
              confirmEffortChange: live !== undefined,
              openMenu,
              onOpenMenuChange: setOpenMenu,
              bypassPermissionsAllowed,
            }}
          />
        )}
      </div>
    </div>
  );
}
