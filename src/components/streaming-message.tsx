import {useEffect, useRef, useMemo, useSyncExternalStore} from "react";
import {renderMarkdownWithHighlighting} from "../lib/client-markdown";
import {UserPlainText} from "./user-plain-text";
import {getHighlighterSync, getHighlighterVersion, subscribeHighlighter} from "../hooks/use-shiki";
import {useCodeThemes} from "../hooks/use-code-themes";
import {handleCodeCopyClick} from "../lib/code-copy";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";
import styles from "./markdown-article.module.css";
import {USER_MESSAGE_CLASS} from "./user-bubble";
import {UserBubbleBox} from "./user-bubble-box";

interface StreamingMessageProps {
	text: string;
	isComplete: boolean;
	error?: string | undefined;
	forkedSessionId?: string | undefined;
	sentPrompt?: string | undefined;
}

export function StreamingMessage({text, isComplete, error, forkedSessionId, sentPrompt}: StreamingMessageProps) {
	const endRef = useRef<HTMLDivElement>(null);

	// Scroll the streaming widget into view once per submission, so the user
	// can see their prompt and the incoming response. Streaming tokens after
	// that should not yank the viewport — the user is reading.
	useEffect(() => {
		if (sentPrompt === undefined) return;
		endRef.current?.scrollIntoView({behavior: "smooth", block: "end"});
	}, [sentPrompt]);

	const highlighterVersion = useSyncExternalStore(subscribeHighlighter, getHighlighterVersion, () => 0);

	const codeThemes = useCodeThemes();

	const renderedHtml = useMemo(() => {
		void highlighterVersion;
		return renderMarkdownWithHighlighting(text, getHighlighterSync(), {codeThemes});
	}, [text, codeThemes, highlighterVersion]);

	return (
		<div className={`${CHAT_COLUMN_CLASS} py-4`}>
			{sentPrompt && (
				<div className={`${USER_MESSAGE_CLASS} mb-6`} data-perf-pending-prompt="">
					<UserBubbleBox>
						<UserPlainText text={sentPrompt} />
					</UserBubbleBox>
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
							Thinking...
						</div>
					) : (
						<div className="min-w-0 text-body text-primary">
							{renderedHtml ? (
								// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- delegates clicks from the rendered links and copy buttons inside it, which are keyboard-reachable themselves
								<article
									className={styles["markdown"]}
									onClick={handleCodeCopyClick}
									dangerouslySetInnerHTML={{__html: renderedHtml}}
								/>
							) : null}
							{!isComplete && <span className="inline-block h-3 w-0.5 animate-pulse bg-t6 ml-0.5" />}
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
