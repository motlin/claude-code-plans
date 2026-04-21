import {useEffect, useRef, useMemo} from 'react';
import {renderMarkdownToHtml} from '../lib/client-markdown';
import styles from './markdown-article.module.css';

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
		endRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
	}, [sentPrompt]);

	const renderedHtml = useMemo(() => {
		return renderMarkdownToHtml(text);
	}, [text]);

	return (
		<div className="mx-auto w-full max-w-3xl px-8 py-4">
			{sentPrompt && (
				<div className="flex flex-col items-end gap-1 mb-6">
					<div className="rounded-lg px-3 py-2 break-words min-w-0 overflow-hidden bg-bg-100 text-text-000 max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] text-sm leading-relaxed whitespace-pre-wrap">
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
						<div className="flex items-center gap-2 text-sm text-text-500">
							<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent-100" />
							Thinking...
						</div>
					) : (
						<div className="min-w-0 text-sm leading-relaxed text-text-100">
							{renderedHtml ? (
								<article
									className={styles['markdown']}
									dangerouslySetInnerHTML={{__html: renderedHtml}}
								/>
							) : null}
							{!isComplete && (
								<span className="inline-block h-3 w-0.5 animate-pulse bg-text-500 ml-0.5" />
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
