import {useEffect, useRef, useMemo} from 'react';
import MarkdownIt from 'markdown-it';
import styles from './markdown-article.module.css';

let md: MarkdownIt | null = null;
function getMd(): MarkdownIt {
	if (!md) md = MarkdownIt({html: true, linkify: true});
	return md;
}

interface StreamingMessageProps {
	text: string;
	isComplete: boolean;
	error?: string | undefined;
	forkedSessionId?: string | undefined;
	sentPrompt?: string | undefined;
}

export function StreamingMessage({text, isComplete, error, forkedSessionId, sentPrompt}: StreamingMessageProps) {
	const endRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		endRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
	}, [text]);

	const renderedHtml = useMemo(() => {
		if (!text) return '';
		return getMd().render(text);
	}, [text]);

	return (
		<div className="mx-auto w-full max-w-3xl px-8 py-4">
			{sentPrompt && (
				<div className="flex items-start gap-1 flex-row-reverse mb-6">
					<UserAvatarSmall />
					<div className="rounded-lg px-3 py-2 break-words min-w-0 overflow-hidden bg-bg-100 text-text-000 ml-auto max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] text-sm leading-relaxed whitespace-pre-wrap">
						{sentPrompt}
					</div>
				</div>
			)}

			{error ? (
				<div className="rounded-lg border border-red-300/30 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800/30 dark:bg-red-950/30 dark:text-red-300">
					{error}
				</div>
			) : (
				<div
					className="grid gap-1 min-w-0"
					style={{gridTemplateColumns: '16px 1fr'}}
				>
					<div className="flex items-start justify-center">
						<ClaudeStreamingIcon />
					</div>
					{!text && !isComplete ? (
						<div className="flex items-center gap-2 text-sm text-text-500">
							<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent-100" />
							Thinking...
						</div>
					) : (
						<div className="min-w-0 flex-1 text-sm leading-relaxed text-text-100">
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
				<div
					className="mt-3 grid gap-1"
					style={{gridTemplateColumns: '16px 1fr'}}
				>
					<div />
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

function UserAvatarSmall() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 32 32"
			fill="none"
			className="mt-0.5 shrink-0"
		>
			<circle
				cx="16"
				cy="10"
				r="5"
				fill="currentColor"
				opacity="0.7"
			/>
			<path
				d="M8 24c0-4.418 3.582-8 8-8s8 3.582 8 8"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				opacity="0.7"
			/>
		</svg>
	);
}

function ClaudeStreamingIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 32 32"
			fill="none"
			className="mt-0.5 shrink-0"
		>
			<rect
				width="32"
				height="32"
				rx="7"
				fill="#C87B3A"
			/>
			<path
				d="M16 5L17.5 13.5L26 16L17.5 18.5L16 27L14.5 18.5L6 16L14.5 13.5Z"
				fill="white"
				opacity="0.95"
			/>
		</svg>
	);
}
