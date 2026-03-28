import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Copy, Link2} from 'lucide-react';
import {MarkdownArticle} from './markdown-article';
import {getToolRenderer} from './tool-renderers';
import type {ClientToolCall} from './tool-renderers';
import {DurationBadge} from './tool-renderers/shared';
import {TasksView} from './tasks-view';

function formatTimestamp(timestamp?: string): string | null {
	if (!timestamp) return null;
	try {
		const date = new Date(timestamp);
		if (isNaN(date.getTime())) return null;

		const now = new Date();
		const isToday = date.toDateString() === now.toDateString();

		if (isToday) {
			return date.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', hour12: true});
		} else {
			return (
				date.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) +
				' ' +
				date.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', hour12: true})
			);
		}
	} catch {
		return null;
	}
}

interface ChatMessage {
	role: 'user' | 'assistant';
	timestamp?: string;
	textBlocks: string[];
	htmlBlocks: string[];
	thinkingBlocks: string[];
	imageBlocks: Array<{mediaType: string; data: string}>;
	documentBlocks: Array<{mediaType: string; data: string}>;
	toolCalls: ClientToolCall[];
	toolSummary: string;
	command?: {name: string; args?: string};
}

interface SessionChatProps {
	messages: ChatMessage[];
	showThinking?: boolean;
	showTools?: boolean;
}

function CopyToast({visible}: {visible: boolean}) {
	return (
		<span
			className={`absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-bg-200 px-1.5 py-0.5 text-[10px] text-text-300 shadow-sm transition-opacity whitespace-nowrap ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
		>
			Copied!
		</span>
	);
}

function MessageToolbar({msg, index}: {msg: ChatMessage; index: number}) {
	const [copied, setCopied] = useState<'text' | 'link' | null>(null);

	function copyText() {
		const text = msg.textBlocks.join('\n\n');
		navigator.clipboard.writeText(text);
		setCopied('text');
		setTimeout(() => setCopied(null), 1500);
	}

	function copyLink() {
		const url = `${window.location.origin}${window.location.pathname}#msg-${index}`;
		navigator.clipboard.writeText(url);
		setCopied('link');
		setTimeout(() => setCopied(null), 1500);
	}

	return (
		<div className="absolute -top-3 right-0 hidden group-hover:flex items-center gap-1 bg-bg-000 border border-border-300/15 rounded-md shadow-sm px-1 py-0.5 z-10">
			<div className="relative">
				<button
					type="button"
					title="Copy message"
					onClick={copyText}
					className="p-1 text-text-500 hover:text-text-000 cursor-pointer"
				>
					<Copy className="h-3 w-3" />
				</button>
				<CopyToast visible={copied === 'text'} />
			</div>
			<div className="relative">
				<button
					type="button"
					title="Copy link"
					onClick={copyLink}
					className="p-1 text-text-500 hover:text-text-000 cursor-pointer"
				>
					<Link2 className="h-3 w-3" />
				</button>
				<CopyToast visible={copied === 'link'} />
			</div>
		</div>
	);
}

export const SessionChat = React.memo(function SessionChat({
	messages,
	showThinking = true,
	showTools = true,
}: SessionChatProps) {
	const endRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		requestAnimationFrame(() => {
			endRef.current?.scrollIntoView({block: 'end'});
		});
	}, []);

	return (
		<div className="mx-auto w-full max-w-3xl px-8 pt-4 pb-4">
			{messages.map((msg, i) => {
				const prevRole = i > 0 ? messages[i - 1]!.role : null;
				const isNewTurn = prevRole !== null && prevRole !== msg.role;
				return (
					<div
						key={i}
						id={`msg-${i}`}
						className={`group relative ${isNewTurn ? 'pb-6' : ''}`}
					>
						<MessageToolbar
							msg={msg}
							index={i}
						/>
						{msg.role === 'user' ? (
							<UserMessage msg={msg} />
						) : (
							<AssistantMessage
								msg={msg}
								showThinking={showThinking}
								showTools={showTools}
							/>
						)}
					</div>
				);
			})}
			<div ref={endRef} />
		</div>
	);
});

function TruncatedContent({children}: {children: React.ReactNode}) {
	const contentRef = useRef<HTMLDivElement>(null);
	const [isTruncated, setIsTruncated] = useState(false);
	const [showFull, setShowFull] = useState(false);

	const measureRef = useCallback((node: HTMLDivElement | null) => {
		if (node) {
			contentRef.current = node;
			setIsTruncated(node.scrollHeight > 200);
		}
	}, []);

	if (showFull) {
		return <div>{children}</div>;
	}

	return (
		<div className="relative">
			<div
				ref={measureRef}
				className={isTruncated ? 'max-h-[200px] overflow-hidden' : ''}
			>
				{children}
			</div>
			{isTruncated && (
				<>
					<div
						className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
						style={{background: 'linear-gradient(to bottom, transparent, var(--bg-100))'}}
					/>
					<button
						type="button"
						onClick={() => setShowFull(true)}
						className="text-xs text-accent-100 hover:underline cursor-pointer mt-1"
					>
						Show more
					</button>
				</>
			)}
		</div>
	);
}

function UserMessage({msg}: {msg: ChatMessage}) {
	const timestampText = formatTimestamp(msg.timestamp);

	if (msg.command) {
		return (
			<div className="flex flex-col items-end gap-1">
				<div className="rounded-lg px-3 py-2 bg-bg-100 text-text-000 max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%]">
					<span className="bg-bg-200 rounded-full px-2 py-0.5 text-xs font-mono">{msg.command.name}</span>
					{msg.command.args && <span className="text-xs text-text-500 ml-1.5">{msg.command.args}</span>}
				</div>
				{timestampText && <div className="text-xs text-text-500 leading-tight">{timestampText}</div>}
			</div>
		);
	}

	return (
		<div className="flex flex-col items-end gap-1.5">
			{msg.htmlBlocks.map((html, i) => (
				<div
					key={i}
					className="rounded-lg px-3 py-2 break-words min-w-0 overflow-hidden bg-bg-100 text-text-000 max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] text-sm leading-relaxed"
				>
					<TruncatedContent>
						<MarkdownArticle html={html} />
					</TruncatedContent>
				</div>
			))}
			{msg.documentBlocks.map((_, i) => (
				<div
					key={i}
					className="rounded-lg px-3 py-2 bg-bg-100 text-text-000 flex items-center gap-1.5 max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%]"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						className="shrink-0"
					>
						<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
						<polyline points="13 2 13 9 20 9" />
					</svg>
					<span className="text-sm">PDF attached</span>
				</div>
			))}
			{timestampText && <div className="text-xs text-text-500 leading-tight">{timestampText}</div>}
		</div>
	);
}

function ThinkingBlock({thinking}: {thinking: string}) {
	const [open, setOpen] = useState(false);

	return (
		<div className="border-l-2 border-warning-100 pl-3 my-1">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="text-xs text-warning-100 cursor-pointer flex items-center gap-1 leading-tight"
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 20 20"
					fill="none"
					className="shrink-0 transition-transform duration-200"
					style={{transform: open ? 'rotate(0deg)' : 'rotate(-90deg)'}}
				>
					<path
						d="M14.128 7.165a.625.625 0 0 1 .707-.038l.128.098a.625.625 0 0 1 .037.844l-4.5 5-.157.131a.625.625 0 0 1-.686 0L9.5 13.069l-4.5-5-.07-.107a.625.625 0 0 1 .07-.737l.107-.098a.625.625 0 0 1 .765.038L10 11.585l4.128-4.42Z"
						fill="currentColor"
					/>
				</svg>
				Thinking...
			</button>
			<div className={`grid ${open ? 'grid-rows-expand' : 'grid-rows-collapse'}`}>
				<div className="overflow-hidden">
					<div className="mt-1 text-xs italic text-text-500 whitespace-pre-wrap bg-bg-200/50 rounded p-2 max-h-64 overflow-auto leading-relaxed">
						{thinking}
					</div>
				</div>
			</div>
		</div>
	);
}

function AssistantMessage({
	msg,
	showThinking = true,
	showTools = true,
}: {
	msg: ChatMessage;
	showThinking?: boolean;
	showTools?: boolean;
}) {
	const thinkingText = msg.thinkingBlocks.length > 0 ? msg.thinkingBlocks.join('\n\n---\n\n') : null;
	const timestampText = formatTimestamp(msg.timestamp);

	return (
		<div className="flex flex-col gap-1.5 min-w-0">
			{showThinking && thinkingText && <ThinkingBlock thinking={thinkingText} />}
			{msg.htmlBlocks.map((html, i) => (
				<div
					key={`text-${i}`}
					className="min-w-0 text-sm leading-relaxed text-text-100"
				>
					<MarkdownArticle html={html} />
				</div>
			))}
			{msg.imageBlocks.map((img, i) => (
				<img
					key={`img-${i}`}
					src={`data:${img.mediaType};base64,${img.data}`}
					alt="Session image"
					className="max-w-full max-h-96 rounded-lg border border-border-300/15 shadow-sm"
				/>
			))}
			{showTools && msg.toolCalls.length > 0 && (
				<ToolCallSummary
					calls={msg.toolCalls}
					summary={msg.toolSummary}
				/>
			)}
			{timestampText && <div className="text-xs text-text-500 leading-tight">{timestampText}</div>}
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

const INITIAL_TOOL_COUNT = 3;
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList']);

function ToolCallSummary({calls, summary}: {calls: ClientToolCall[]; summary: string}) {
	const [expanded, setExpanded] = useState(false);
	const [showAll, setShowAll] = useState(false);

	const taskCalls = calls.filter((c) => TASK_TOOLS.has(c.name));
	const hasTasksView = taskCalls.length >= 3;
	const displayCalls = hasTasksView ? calls.filter((c) => !TASK_TOOLS.has(c.name)) : calls;
	const visibleCalls = showAll ? displayCalls : displayCalls.slice(0, INITIAL_TOOL_COUNT);
	const hiddenCount = displayCalls.length - INITIAL_TOOL_COUNT;

	return (
		<div className="min-w-0 py-1">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex items-center gap-2 py-1 text-sm leading-relaxed transition-colors cursor-pointer w-full text-left text-text-500 hover:text-text-300"
			>
				<ChevronIcon expanded={expanded} />
				<span>{summary}</span>
			</button>
			<div className={`grid ${expanded ? 'grid-rows-expand' : 'grid-rows-collapse'}`}>
				<div className="overflow-hidden">
					{hasTasksView && (
						<div className="ml-2 mb-2">
							<TasksView toolCalls={calls} />
						</div>
					)}
					<div className="ml-2 pl-0">
						{visibleCalls.map((call, i) => {
							const Renderer = getToolRenderer(call.name);
							const isLast = i === visibleCalls.length - 1 && (showAll || hiddenCount <= 0);
							return (
								<div
									key={i}
									className="flex"
								>
									<div className="flex flex-col items-center w-4 shrink-0">
										<div
											className={`w-px flex-1 ${i === 0 ? 'bg-transparent' : 'bg-border-300/15'}`}
										/>
										<div className="w-full h-px bg-border-300/15" />
										<div
											className={`w-px flex-1 ${isLast ? 'bg-transparent' : 'bg-border-300/15'}`}
										/>
									</div>
									<div className="flex-1 min-w-0 pl-2 py-0.5 text-sm leading-relaxed text-text-500">
										<div className="flex items-center">
											<span className="font-medium text-[13px]">{call.name}</span>
											{call.param && (
												<span className="ml-1.5 font-mono text-[11px] bg-bg-100 px-1 py-px rounded opacity-70">
													{call.param}
												</span>
											)}
											{call.duration !== undefined && <DurationBadge duration={call.duration} />}
										</div>
										<div className="mt-1 mb-2 text-xs text-text-100 leading-relaxed">
											<Renderer toolCall={call} />
										</div>
									</div>
								</div>
							);
						})}
						{!showAll && hiddenCount > 0 && (
							<div className="flex">
								<div className="flex flex-col items-center w-4 shrink-0">
									<div className="w-px flex-1 bg-border-300/15" />
									<div className="w-full h-px bg-border-300/15" />
									<div className="w-px flex-1 bg-transparent" />
								</div>
								<div className="flex-1 min-w-0 pl-2">
									<button
										type="button"
										onClick={() => setShowAll(true)}
										className="text-[13px] text-text-500 hover:text-text-300 cursor-pointer transition-colors py-1"
									>
										Show {hiddenCount} more
									</button>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
