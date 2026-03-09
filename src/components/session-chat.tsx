import {useEffect, useRef, useState} from 'react';
import {MarkdownArticle} from './markdown-article';

interface ToolCallItem {
	name: string;
	param: string;
}

interface ChatMessage {
	role: 'user' | 'assistant';
	htmlBlocks: string[];
	toolCalls: ToolCallItem[];
	toolSummary: string;
}

export function SessionChat({messages}: {messages: ChatMessage[]}) {
	const endRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		requestAnimationFrame(() => {
			endRef.current?.scrollIntoView({block: 'end'});
		});
	}, []);

	return (
		<div className="mx-auto w-full max-w-3xl px-8 pt-4">
			{messages.map((msg, i) => {
				const prevRole = i > 0 ? messages[i - 1]!.role : null;
				const isNewTurn = prevRole !== null && prevRole !== msg.role;
				return (
					<div
						key={i}
						className={isNewTurn ? 'pb-4' : ''}
					>
						{msg.role === 'user' ? (
							<UserMessage texts={msg.htmlBlocks} />
						) : (
							<AssistantMessage
								htmlBlocks={msg.htmlBlocks}
								toolCalls={msg.toolCalls}
								toolSummary={msg.toolSummary}
								isFirst={i === 0 || messages[i - 1]!.role !== 'assistant'}
							/>
						)}
					</div>
				);
			})}
			<div ref={endRef} />
		</div>
	);
}

function UserMessage({texts}: {texts: string[]}) {
	return (
		<div className="flex flex-col items-end gap-2 ml-auto max-w-[85%] w-fit">
			{texts.map((text, i) => (
				<div
					key={i}
					className="whitespace-pre-wrap rounded-lg px-3 py-2 break-words min-w-0 overflow-hidden bg-[rgb(245,244,237)] text-[rgb(20,20,19)] dark:bg-[hsl(220,13%,18%)] dark:text-[hsl(210,40%,98%)]"
					style={{fontSize: '14px', fontWeight: 430, lineHeight: '19.6px'}}
				>
					{text}
				</div>
			))}
		</div>
	);
}

function ClaudeIcon() {
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

function AssistantMessage({
	htmlBlocks,
	toolCalls,
	toolSummary,
	isFirst,
}: {
	htmlBlocks: string[];
	toolCalls: ToolCallItem[];
	toolSummary: string;
	isFirst: boolean;
}) {
	return (
		<div className="flex flex-col gap-1.5 min-w-0">
			{htmlBlocks.map((html, i) => (
				<div
					key={`text-${i}`}
					className="flex items-start gap-1 max-w-full min-w-0 text-sm"
				>
					{isFirst && i === 0 ? <ClaudeIcon /> : <div className="w-4 shrink-0" />}
					<div className="min-w-0 flex-1 text-sm text-foreground">
						<MarkdownArticle html={html} />
					</div>
				</div>
			))}
			{toolCalls.length > 0 && (
				<div className="flex items-start gap-1">
					<div className="w-4 shrink-0" />
					<ToolCallSummary
						calls={toolCalls}
						summary={toolSummary}
					/>
				</div>
			)}
		</div>
	);
}

function ChevronIcon({expanded}: {expanded: boolean}) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 20 20"
			fill="none"
			className="shrink-0 transition-transform duration-200"
			style={{
				transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
				color: 'currentColor',
			}}
		>
			<path
				d="M14.128 7.165a.625.625 0 0 1 .707-.038l.128.098a.625.625 0 0 1 .037.844l-4.5 5-.157.131a.625.625 0 0 1-.686 0L9.5 13.069l-4.5-5-.07-.107a.625.625 0 0 1 .07-.737l.107-.098a.625.625 0 0 1 .765.038L10 11.585l4.128-4.42Z"
				fill="currentColor"
			/>
		</svg>
	);
}

function ToolCallSummary({calls, summary}: {calls: ToolCallItem[]; summary: string}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="min-w-0 py-1">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex items-center gap-2 py-1 text-sm transition-colors cursor-pointer w-full text-left"
				style={{color: 'rgb(115, 114, 108)'}}
			>
				<ChevronIcon expanded={expanded} />
				<span>{summary}</span>
			</button>
			{expanded && (
				<div className="ml-2 border-l border-border/40 pl-3">
					{calls.map((call, i) => (
						<div
							key={i}
							className="py-0.5 text-sm"
							style={{color: 'rgb(115, 114, 108)'}}
						>
							<span className="font-medium">{call.name}</span>
							{call.param && <span className="ml-1.5 opacity-70">{call.param}</span>}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
