import {useEffect, useRef, useState} from 'react';
import {MarkdownArticle} from './markdown-article';
import {getToolRenderer} from './tool-renderers';
import type {ClientToolCall} from './tool-renderers';
import {DurationBadge} from './tool-renderers/shared';

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
	htmlBlocks: string[];
	thinkingBlocks: string[];
	imageBlocks: Array<{mediaType: string; data: string}>;
	documentBlocks: Array<{mediaType: string; data: string}>;
	toolCalls: ClientToolCall[];
	toolSummary: string;
	command?: {name: string; args?: string};
}

export function SessionChat({messages}: {messages: ChatMessage[]}) {
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
						className={isNewTurn ? 'pb-6' : ''}
					>
						{msg.role === 'user' ? (
							<UserMessage msg={msg} />
						) : (
							<AssistantMessage
								msg={msg}
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

function UserMessage({msg}: {msg: ChatMessage}) {
	const timestampText = formatTimestamp(msg.timestamp);

	if (msg.command) {
		return (
			<div className="flex items-start gap-1 flex-row-reverse">
				<UserAvatar />
				<div className="flex flex-col items-end gap-2 ml-auto max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] w-fit">
					<div>
						<div className="rounded-lg px-3 py-2 bg-bg-100 text-text-000">
							<span className="bg-bg-200 rounded-full px-2 py-0.5 text-xs font-mono">
								{msg.command.name}
							</span>
							{msg.command.args && (
								<span className="text-xs text-text-500 ml-1.5">{msg.command.args}</span>
							)}
						</div>
						{timestampText && (
							<div className="mt-1 text-right text-xs text-text-500 leading-tight">{timestampText}</div>
						)}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1.5">
			{msg.htmlBlocks.map((html, i) => (
				<div
					key={i}
					className="flex items-start gap-1 flex-row-reverse"
				>
					<UserAvatar />
					<div className="rounded-lg px-3 py-2 break-words min-w-0 overflow-hidden bg-bg-100 text-text-000 ml-auto max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] text-sm leading-relaxed">
						<MarkdownArticle html={html} />
					</div>
				</div>
			))}
			{msg.documentBlocks.map((_, i) => (
				<div
					key={i}
					className="flex items-start gap-1 flex-row-reverse"
				>
					<UserAvatar />
					<div className="rounded-lg px-3 py-2 bg-bg-100 text-text-000 flex items-center gap-1.5 ml-auto max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%]">
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
				</div>
			))}
			{timestampText && (
				<div className="flex items-start gap-1 flex-row-reverse">
					<div className="w-4 shrink-0" />
					<div className="text-xs text-text-500 text-right leading-tight">{timestampText}</div>
				</div>
			)}
		</div>
	);
}

function UserAvatar() {
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
			{open && (
				<div className="mt-1 text-xs italic text-text-500 whitespace-pre-wrap bg-bg-200/50 rounded p-2 max-h-64 overflow-auto leading-relaxed">
					{thinking}
				</div>
			)}
		</div>
	);
}

function AssistantMessage({msg, isFirst}: {msg: ChatMessage; isFirst: boolean}) {
	const thinkingText = msg.thinkingBlocks.length > 0 ? msg.thinkingBlocks.join('\n\n---\n\n') : null;
	const timestampText = formatTimestamp(msg.timestamp);

	return (
		<div className="flex flex-col gap-1.5 min-w-0">
			{thinkingText && (
				<div
					className="grid gap-1 min-w-0"
					style={{gridTemplateColumns: '16px 1fr'}}
				>
					<div className="flex items-start justify-center">
						{isFirst ? <ClaudeIcon /> : <div className="w-4 shrink-0" />}
					</div>
					<div className="min-w-0">
						<ThinkingBlock thinking={thinkingText} />
					</div>
				</div>
			)}
			{msg.htmlBlocks.map((html, i) => (
				<div
					key={`text-${i}`}
					className="grid gap-1 max-w-full min-w-0"
					style={{gridTemplateColumns: '16px 1fr'}}
				>
					<div className="flex items-start justify-center">
						{isFirst && i === 0 && !thinkingText ? <ClaudeIcon /> : <div className="w-4 shrink-0" />}
					</div>
					<div className="min-w-0 flex-1 text-sm leading-relaxed text-text-100">
						<MarkdownArticle html={html} />
					</div>
				</div>
			))}
			{msg.imageBlocks.map((img, i) => (
				<div
					key={`img-${i}`}
					className="grid gap-1"
					style={{gridTemplateColumns: '16px 1fr'}}
				>
					<div className="flex items-start justify-center">
						<div className="w-4 shrink-0" />
					</div>
					<img
						src={`data:${img.mediaType};base64,${img.data}`}
						alt="Session image"
						className="max-w-full max-h-96 rounded-lg border border-border-300/15 shadow-sm"
					/>
				</div>
			))}
			{msg.toolCalls.length > 0 && (
				<div
					className="grid gap-1"
					style={{gridTemplateColumns: '16px 1fr'}}
				>
					<div className="flex items-start justify-center">
						<div className="w-4 shrink-0" />
					</div>
					<ToolCallSummary
						calls={msg.toolCalls}
						summary={msg.toolSummary}
					/>
				</div>
			)}
			{timestampText && (
				<div
					className="grid gap-1"
					style={{gridTemplateColumns: '16px 1fr'}}
				>
					<div className="flex items-start justify-center">
						<div className="w-4 shrink-0" />
					</div>
					<div className="text-xs text-text-500 leading-tight">{timestampText}</div>
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

function ToolCallSummary({calls, summary}: {calls: ClientToolCall[]; summary: string}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="min-w-0 py-1">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex items-center gap-2 py-1 text-sm leading-relaxed transition-colors cursor-pointer w-full text-left text-text-500"
			>
				<ChevronIcon expanded={expanded} />
				<span>{summary}</span>
			</button>
			{expanded && (
				<div className="ml-2 border-l border-border-300/10 pl-3">
					{calls.map((call, i) => {
						const Renderer = getToolRenderer(call.name);
						return (
							<div
								key={i}
								className="py-0.5 text-sm leading-relaxed text-text-500"
							>
								<div className="flex items-center">
									<span className="font-medium text-sm">{call.name}</span>
									{call.param && <span className="ml-1.5 text-xs opacity-70">{call.param}</span>}
									{call.duration !== undefined && <DurationBadge duration={call.duration} />}
								</div>
								<div className="mt-1 mb-2 text-xs text-text-100 leading-relaxed">
									<Renderer toolCall={call} />
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
