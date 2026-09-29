import { useEffect, useId, useRef } from "react";
import { CornerDownLeft, Square } from "lucide-react";

import { useComposerDraft } from "../hooks/use-composer-draft";
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

interface ComposerProps {
  variant: ComposerVariant;
  /** Draft storage key: the session id, or `"home"` for the new-session composer. */
  draftKey: string;
  onSend: (prompt: string) => void;
  onCancel?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  deliveryHint?: string | undefined;
}

/**
 * The claude.ai/code ChatComposer card: an auto-growing prompt editor with a
 * trailing icon Send button and an (empty, for now) chin row beneath.
 */
export function Composer({
  variant,
  draftKey,
  onSend,
  onCancel,
  isStreaming = false,
  disabled = false,
  deliveryHint,
}: ComposerProps) {
  const { text: prompt, setText: setPrompt, clear: clearDraft } = useComposerDraft(draftKey);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const canSend = prompt.trim() !== "" && !isStreaming && !disabled;

  useEffect(() => {
    if (!isStreaming) textareaRef.current?.focus();
  }, [isStreaming]);

  function handleSubmit() {
    if (!canSend) return;
    onSend(prompt.trim());
    clearDraft();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div data-cds="ChatComposer" className="flex w-full min-w-0 flex-col font-sans">
      <div className={CARD_CLASS} onClick={() => textareaRef.current?.focus()}>
        <div className="relative pr-[30px]">
          <textarea
            ref={textareaRef}
            aria-label="Prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={PLACEHOLDER[variant]}
            disabled={isStreaming || disabled}
            rows={1}
            enterKeyHint="enter"
            className={EDITOR_CLASS}
            style={{ minHeight: "24px", maxHeight: "min(24rem, 40svh)" }}
          />
          <div className="absolute right-0 bottom-0 flex min-h-6 items-center pl-1.5">
            {isStreaming ? (
              <Tooltip content="Stop response">
                <button
                  type="button"
                  aria-label="Stop response"
                  onClick={onCancel}
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
      />
    </div>
  );
}
