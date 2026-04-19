import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Copy, Link2} from 'lucide-react';
import {MarkdownArticle} from './markdown-article';
import {getToolRenderer} from './tool-renderers';
import type {ClientToolCall} from './tool-renderers';
import {DurationBadge, TerminalOutput} from './tool-renderers/shared';
import {TasksView} from './tasks-view';
import {DebugLink} from './debug-link';
import {hmrSet} from '../lib/hmr-state';
import {useHmrState} from '../hooks/use-hmr-state';

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

/**
 * Render a formatted timestamp that is hydration-safe. `formatTimestamp` uses
 * `new Date()` and locale-dependent APIs (`toLocaleTimeString`) whose output
 * can differ between the Node.js SSR pass and the browser's first render (due
 * to timezone, locale, or clock-skew). We use `suppressHydrationWarning` so
 * React silently accepts the mismatch on the text node.
 */
function Timestamp({value}: {value: string | null}) {
	if (!value) return null;
	return (
		<div
			className="text-xs text-text-500 leading-tight"
			suppressHydrationWarning
		>
			{value}
		</div>
	);
}

interface ChatMessage {
	role: 'user' | 'assistant';
	timestamp?: string;
	textBlocks: string[];
	htmlBlocks: Array<{html: string; sourceUuid: string}>;
	thinkingBlocks: Array<{thinking: string; sourceUuid: string}>;
	imageBlocks: Array<{mediaType: string; data: string; sourceUuid: string}>;
	documentBlocks: Array<{mediaType: string; data: string; sourceUuid: string}>;
	toolCalls: ClientToolCall[];
	toolSummary: string;
	command?: {name: string; args?: string; sourceUuid: string};
	bash?: {command: string; stdout?: string; stderr?: string; inputUuid: string; outputUuid?: string};
}

interface SessionChatProps {
	sessionId: string;
	messages: ChatMessage[];
	showThinking?: boolean;
	showTools?: boolean;
}

// Tracks which sessions have already been auto-scrolled during this tab's
// lifetime. Stored on globalThis so it survives Vite HMR reloads in addition
// to component remounts and loader revalidation.
const autoScrolledSessions = hmrSet<string>('autoScrolledSessions');

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
	sessionId,
	messages,
	showThinking = true,
	showTools = true,
}: SessionChatProps) {
	const endRef = useRef<HTMLDivElement>(null);

	// Scroll to bottom the first time the user opens this session.
	// Remounts (HMR, loader revalidation) won't re-trigger because the
	// session id is already in autoScrolledSessions.
	useEffect(() => {
		if (autoScrolledSessions.has(sessionId)) return;
		autoScrolledSessions.add(sessionId);
		requestAnimationFrame(() => {
			endRef.current?.scrollIntoView({block: 'end'});
		});
	}, [sessionId]);

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
							<UserMessage
								msg={msg}
								sessionId={sessionId}
							/>
						) : (
							<AssistantMessage
								msg={msg}
								sessionId={sessionId}
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
		<div>
			<div className="relative">
				<div
					ref={measureRef}
					className={isTruncated ? 'max-h-[200px] overflow-hidden' : ''}
				>
					{children}
				</div>
				{isTruncated && (
					<button
						type="button"
						onClick={() => setShowFull(true)}
						aria-label="Show more"
						className="absolute inset-x-0 bottom-0 h-16 cursor-pointer"
						style={{background: 'linear-gradient(to bottom, transparent, var(--bg-100))'}}
					/>
				)}
			</div>
			{isTruncated && (
				<div className="mt-1 flex">
					<button
						type="button"
						onClick={() => setShowFull(true)}
						className="text-xs font-medium text-accent-100 hover:text-accent-000 cursor-pointer rounded-full bg-bg-200 px-2 py-0.5"
					>
						Show more
					</button>
				</div>
			)}
		</div>
	);
}

function UserMessage({msg, sessionId}: {msg: ChatMessage; sessionId: string}) {
	const timestampText = formatTimestamp(msg.timestamp);

	if (msg.command) {
		return (
			<div className="flex flex-col items-end gap-1">
				<div className="relative rounded-lg px-3 py-2 bg-bg-100 text-text-000 max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%]">
					<span className="bg-bg-200 rounded-full px-2 py-0.5 text-xs font-mono">{msg.command.name}</span>
					{msg.command.args && <span className="text-xs text-text-500 ml-1.5">{msg.command.args}</span>}
					<DebugLink
						sessionId={sessionId}
						uuid={msg.command.sourceUuid}
						className="absolute top-1 right-1"
					/>
				</div>
				<Timestamp value={timestampText} />
			</div>
		);
	}

	if (msg.bash) {
		return (
			<div className="flex flex-col items-end gap-1">
				<div className="relative rounded-lg p-2 bg-bg-100 text-text-000 max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] min-w-0">
					<div className="bg-bg-200 rounded px-2 py-1.5 font-mono text-xs flex items-start gap-2">
						<span className="text-text-500">! </span>
						<span className="text-success-000 break-all flex-1">{msg.bash.command}</span>
						<DebugLink
							sessionId={sessionId}
							uuid={msg.bash.inputUuid}
						/>
					</div>
					{msg.bash.stdout && (
						<div className="mt-1 relative">
							<TerminalOutput content={msg.bash.stdout} />
							<DebugLink
								sessionId={sessionId}
								uuid={msg.bash.outputUuid}
								className="absolute top-1 right-1"
							/>
						</div>
					)}
					{msg.bash.stderr && (
						<div className="mt-1 border-l-2 border-danger-000 bg-danger-000/10 rounded-r relative">
							<TerminalOutput content={msg.bash.stderr} />
							{!msg.bash.stdout && (
								<DebugLink
									sessionId={sessionId}
									uuid={msg.bash.outputUuid}
									className="absolute top-1 right-1"
								/>
							)}
						</div>
					)}
				</div>
				<Timestamp value={timestampText} />
			</div>
		);
	}

	return (
		<div className="flex flex-col items-end gap-1.5">
			{msg.htmlBlocks.map((block, i) => (
				<div
					key={i}
					className="relative rounded-lg px-3 py-2 break-words min-w-0 overflow-hidden bg-bg-100 text-text-000 max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] text-sm leading-relaxed"
				>
					<TruncatedContent>
						<MarkdownArticle html={block.html} />
					</TruncatedContent>
					<DebugLink
						sessionId={sessionId}
						uuid={block.sourceUuid}
						className="absolute top-1 right-1"
					/>
				</div>
			))}
			{msg.documentBlocks.map((doc, i) => (
				<div
					key={i}
					className="relative rounded-lg px-3 py-2 bg-bg-100 text-text-000 flex items-center gap-1.5 max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%]"
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
					<DebugLink
						sessionId={sessionId}
						uuid={doc.sourceUuid}
						className="absolute top-1 right-1"
					/>
				</div>
			))}
			<Timestamp value={timestampText} />
		</div>
	);
}

function ThinkingBlock({
	thinking,
	sessionId,
	sourceUuid,
}: {
	thinking: string;
	sessionId?: string;
	sourceUuid?: string | undefined;
}) {
	const [open, setOpen] = useState(false);

	return (
		<div className="border-l-2 border-warning-100 pl-3 my-1">
			<div className="flex items-center gap-2">
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
				{sessionId && (
					<DebugLink
						sessionId={sessionId}
						uuid={sourceUuid}
					/>
				)}
			</div>
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
	sessionId,
	showThinking = true,
	showTools = true,
}: {
	msg: ChatMessage;
	sessionId: string;
	showThinking?: boolean;
	showTools?: boolean;
}) {
	const firstThinkingUuid = msg.thinkingBlocks[0]?.sourceUuid;
	const thinkingText =
		msg.thinkingBlocks.length > 0 ? msg.thinkingBlocks.map((b) => b.thinking).join('\n\n---\n\n') : null;
	const timestampText = formatTimestamp(msg.timestamp);

	return (
		<div className="flex flex-col gap-1.5 min-w-0">
			{showThinking && thinkingText && (
				<ThinkingBlock
					thinking={thinkingText}
					sessionId={sessionId}
					sourceUuid={firstThinkingUuid}
				/>
			)}
			{msg.htmlBlocks.map((block, i) => (
				<div
					key={`text-${i}`}
					className="relative min-w-0 text-sm leading-relaxed text-text-100"
				>
					<MarkdownArticle html={block.html} />
					<DebugLink
						sessionId={sessionId}
						uuid={block.sourceUuid}
						className="absolute top-0 right-0"
					/>
				</div>
			))}
			{msg.imageBlocks.map((img, i) => (
				<div
					key={`img-${i}`}
					className="relative inline-block"
				>
					<img
						src={`data:${img.mediaType};base64,${img.data}`}
						alt="Session image"
						className="max-w-full max-h-96 rounded-lg border border-border-300/15 shadow-sm"
					/>
					<DebugLink
						sessionId={sessionId}
						uuid={img.sourceUuid}
						className="absolute top-1 right-1"
					/>
				</div>
			))}
			{showTools && msg.toolCalls.length > 0 && (
				<ToolCallSection
					calls={msg.toolCalls}
					summary={msg.toolSummary}
					sessionId={sessionId}
				/>
			)}
			<Timestamp value={timestampText} />
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

const PROMINENT_TOOLS = new Set(['AskUserQuestion']);
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList']);

type ToolListItem = {kind: 'call'; call: ClientToolCall} | {kind: 'parallel'; key: string; calls: ClientToolCall[]};

/**
 * Group consecutive Agent tool calls that share a `parallelGroupKey` into a
 * single "parallel × N" entry. Matches the grouping used by the top-of-page
 * subagent tree (src/components/subagent-tree.tsx) so users see the same
 * grouping inline at the spawn point.
 */
function groupParallelSubagents(calls: ClientToolCall[]): ToolListItem[] {
	const result: ToolListItem[] = [];
	let i = 0;
	while (i < calls.length) {
		const call = calls[i]!;
		const key = call.subagentInfo?.parallelGroupKey;
		if (key) {
			const group: ClientToolCall[] = [call];
			let j = i + 1;
			while (j < calls.length && calls[j]!.subagentInfo?.parallelGroupKey === key) {
				group.push(calls[j]!);
				j++;
			}
			if (group.length > 1) {
				result.push({kind: 'parallel', key, calls: group});
				i = j;
				continue;
			}
		}
		result.push({kind: 'call', call});
		i++;
	}
	return result;
}

function ToolCallSection({calls, summary, sessionId}: {calls: ClientToolCall[]; summary: string; sessionId: string}) {
	const prominentCalls = calls.filter((c) => PROMINENT_TOOLS.has(c.name));
	const backgroundCalls = calls.filter((c) => !PROMINENT_TOOLS.has(c.name));

	return (
		<>
			{backgroundCalls.length > 0 && (
				<ToolCallSummary
					calls={backgroundCalls}
					summary={summary}
					sessionId={sessionId}
				/>
			)}
			{prominentCalls.map((call, i) => {
				const Renderer = getToolRenderer(call.name);
				return (
					<div
						key={`prominent-${i}`}
						className="relative rounded-lg border border-accent-100/20 bg-accent-900/30 p-3 text-sm"
					>
						<Renderer toolCall={call} />
						<DebugLink
							sessionId={sessionId}
							uuid={call.sourceUuid}
							className="absolute top-1 right-1"
						/>
					</div>
				);
			})}
		</>
	);
}

function ToolCallRow({
	call,
	sessionId,
	isFirst,
	isLast,
}: {
	call: ClientToolCall;
	sessionId: string;
	isFirst: boolean;
	isLast: boolean;
}) {
	const Renderer = getToolRenderer(call.name);
	return (
		<div className="flex">
			<div className="flex flex-col items-center w-4 shrink-0">
				<div className={`w-px flex-1 ${isFirst ? 'bg-transparent' : 'bg-border-300/15'}`} />
				<div className="w-full h-px bg-border-300/15" />
				<div className={`w-px flex-1 ${isLast ? 'bg-transparent' : 'bg-border-300/15'}`} />
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
					<DebugLink
						sessionId={sessionId}
						uuid={call.sourceUuid}
						className="ml-1.5"
					/>
				</div>
				<div className="mt-1 mb-2 text-xs text-text-100 leading-relaxed">
					<Renderer toolCall={call} />
				</div>
			</div>
		</div>
	);
}

function ParallelGroupInline({
	calls,
	sessionId,
	isFirst,
	isLast,
}: {
	calls: ClientToolCall[];
	sessionId: string;
	isFirst: boolean;
	isLast: boolean;
}) {
	const [expanded, setExpanded] = useHmrState('parallel', calls[0]?.sourceUuid ?? 'unknown', true);
	const size = calls.length;

	return (
		<div className="flex">
			<div className="flex flex-col items-center w-4 shrink-0">
				<div className={`w-px flex-1 ${isFirst ? 'bg-transparent' : 'bg-border-300/15'}`} />
				<div className="w-full h-px bg-border-300/15" />
				<div className={`w-px flex-1 ${isLast ? 'bg-transparent' : 'bg-border-300/15'}`} />
			</div>
			<div className="flex-1 min-w-0 pl-2 py-0.5">
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="flex items-center gap-1.5 text-[12px] text-text-500 hover:text-text-300 cursor-pointer"
				>
					<ChevronIcon expanded={expanded} />
					<span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-accent-000/12 text-accent-100">
						parallel &times;{size}
					</span>
					<span className="text-[11px] text-text-500">
						{calls
							.map((c) => (c.input['description'] as string) || (c.input['subagent_type'] as string))
							.filter(Boolean)
							.slice(0, 3)
							.join(', ')}
					</span>
				</button>
				{expanded && (
					<div className="mt-1 ml-2 pl-2 border-l border-accent-000/20">
						{calls.map((call, i) => (
							<ToolCallRow
								key={i}
								call={call}
								sessionId={sessionId}
								isFirst={i === 0}
								isLast={i === calls.length - 1}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function ToolCallSummary({calls, summary, sessionId}: {calls: ClientToolCall[]; summary: string; sessionId: string}) {
	const [expanded, setExpanded] = useHmrState('toolSummary', calls[0]?.sourceUuid ?? 'unknown', false);

	const taskCalls = calls.filter((c) => TASK_TOOLS.has(c.name));
	const hasTasksView = taskCalls.length >= 3;
	const displayCalls = hasTasksView ? calls.filter((c) => !TASK_TOOLS.has(c.name)) : calls;
	const items = groupParallelSubagents(displayCalls);

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
						{items.map((item, i) => {
							const isFirst = i === 0;
							const isLast = i === items.length - 1;
							if (item.kind === 'parallel') {
								return (
									<ParallelGroupInline
										key={`pg-${item.key}`}
										calls={item.calls}
										sessionId={sessionId}
										isFirst={isFirst}
										isLast={isLast}
									/>
								);
							}
							return (
								<ToolCallRow
									key={i}
									call={item.call}
									sessionId={sessionId}
									isFirst={isFirst}
									isLast={isLast}
								/>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}
