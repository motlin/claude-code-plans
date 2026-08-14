import { useEffect, useRef, useMemo, useSyncExternalStore } from "react";
import { renderMarkdownWithHighlighting } from "../lib/client-markdown";
import {
  getHighlighterSync,
  getHighlighterVersion,
  subscribeHighlighter,
} from "../hooks/use-shiki";
import { handleCodeCopyClick } from "../lib/code-copy";
import styles from "./markdown-article.module.css";

interface StreamingMessageProps {
  text: string;
  isComplete: boolean;
  error?: string | undefined;
  forkedSessionId?: string | undefined;
  sentPrompt?: string | undefined;
  pendingLabel?: string | undefined;
}

export function StreamingMessage({
  text,
  isComplete,
  error,
  forkedSessionId,
  sentPrompt,
  pendingLabel = "Thinking...",
}: StreamingMessageProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // Scroll the streaming widget into view once per submission, so the user
  // can see their prompt and the incoming response. Streaming tokens after
  // that should not yank the viewport — the user is reading.
  useEffect(() => {
    if (sentPrompt === undefined) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [sentPrompt]);

  const highlighterVersion = useSyncExternalStore(
    subscribeHighlighter,
    getHighlighterVersion,
    () => 0,
  );

  const renderedHtml = useMemo(() => {
    void highlighterVersion;
    return renderMarkdownWithHighlighting(text, getHighlighterSync());
  }, [text, highlighterVersion]);

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-4">
      {sentPrompt && (
        <div className="flex flex-col items-start gap-1 mb-6">
          <div className="user-message-bubble flex flex-col gap-[5px] rounded-r7 px-3 py-2 break-words min-w-0 overflow-hidden bg-user-msg-bg text-user-msg-text max-w-[75%] text-body whitespace-pre-wrap select-text">
            {sentPrompt}
          </div>
        </div>
      )}

      {error ? (
        <div className="rounded-lg border border-danger-000/20 bg-danger-900 px-4 py-3 text-sm text-danger-000">
          {error}
        </div>
      ) : (
        <div className="min-w-0">
          {!text && !isComplete ? (
            <div className="flex items-center gap-2 text-sm text-t6">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent-100" />
              {pendingLabel}
            </div>
          ) : (
            <div className="min-w-0 text-body text-primary">
              {renderedHtml ? (
                <article
                  className={styles["markdown"]}
                  onClick={handleCodeCopyClick}
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              ) : null}
              {!isComplete && (
                <span className="inline-block h-3 w-0.5 animate-pulse bg-t6 ml-0.5" />
              )}
            </div>
          )}
        </div>
      )}

      {isComplete && forkedSessionId && (
        <div className="mt-3">
          <a
            href={`/session/${forkedSessionId}`}
            className="inline-flex items-center gap-1.5 text-xs text-accent-100 hover:underline"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M7 17l9.2-9.2M17 17V7H7" />
            </svg>
            Open forked session
          </a>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
