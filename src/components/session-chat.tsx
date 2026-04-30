import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {formatDistanceToNow} from 'date-fns';
import {Bot, Copy, Link, Link2, Lock, Palette} from 'lucide-react';
import {MarkdownArticle} from './markdown-article';
import {getToolRenderer} from './tool-renderers';
import {buildClientToolCall, buildSubagentLookup} from './tool-renderers/types';
import type {ClientToolCall} from './tool-renderers';
import {ChevronIcon, TerminalOutput} from './tool-renderers/shared';
import {computeDiffData} from '../lib/diff-utils';
import {TasksView} from './tasks-view';
import {DebugLink} from './debug-link';
import {hmrPersist} from '../lib/hmr-persist';
import {writeClipboardText} from '../lib/clipboard';
import type {MessageSessionLine, SessionLine, SessionContentBlock, ToolResultInfo} from '../lib/sessions';
import type {ToolUseBlock} from '../lib/schemas';
import type {SubagentTreeEntry} from '../lib/db/queries';
import {AttachmentBanner, Banner} from './attachment-banner';
import {
	stripCommandTags,
	parseCommandBlock,
	parseBashInput,
	parseBashOutput,
	formatToolName,
	summarizeToolCallsStructured,
} from '../lib/session-utils';
import type {SummarySegment} from '../lib/session-utils';

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

function formatRelativeTimestamp(timestamp?: string): string | null {
	if (!timestamp) return null;
	try {
		const date = new Date(timestamp);
		if (isNaN(date.getTime())) return null;
		return formatDistanceToNow(date, {addSuffix: true});
	} catch {
		return null;
	}
}

function getLineTimestamp(line: SessionLine): string | undefined {
	if ('timestamp' in line) return line.timestamp;
	return undefined;
}

export interface SessionChatProps {
	sessionId: string;
	lines: SessionLine[];
	toolResultMap: Map<string, ToolResultInfo>;
	subagentTree: SubagentTreeEntry[];
	showThinking?: boolean;
	showTools?: boolean;
	showPassedHooks?: boolean;
	showHookWarnings?: boolean;
	showHookErrors?: boolean;
	showSystemBanners?: boolean;
}

const autoScrolledSessions = hmrPersist('autoScrolledSessions', () => new Set<string>());

function CopyToast({visible}: {visible: boolean}) {
	return (
		<span
			className={`absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-bg-200 px-1.5 py-0.5 text-[10px] text-text-300 shadow-sm transition-opacity whitespace-nowrap pointer-events-none ${visible ? 'opacity-100' : 'opacity-0'}`}
		>
			Copied!
		</span>
	);
}

function MessageToolbar({line, index, timestamp}: {line: MessageSessionLine; index: number; timestamp?: string}) {
	const [copied, setCopied] = useState<'text' | 'link' | null>(null);
	const relativeTimestamp = formatRelativeTimestamp(timestamp);
	const absoluteTimestamp = formatTimestamp(timestamp);
	const timestampTitle = absoluteTimestamp ?? undefined;

	async function copyText() {
		const texts = extractTextFromLine(line);
		const ok = await writeClipboardText(texts.join('\n\n'));
		if (ok) {
			setCopied('text');
			setTimeout(() => setCopied(null), 1500);
		}
	}

	async function copyLink() {
		const url = `${window.location.origin}${window.location.pathname}#msg-${index}`;
		const ok = await writeClipboardText(url);
		if (ok) {
			setCopied('link');
			setTimeout(() => setCopied(null), 1500);
		}
	}

	return (
		<div className="flex gap-g2 pt-[4px] -mt-[8px] opacity-0 pointer-events-none group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity duration-150">
			<div className="relative">
				<button
					type="button"
					aria-label="Copy message"
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
					aria-label="Copy link"
					onClick={copyLink}
					className="p-1 text-text-500 hover:text-text-000 cursor-pointer"
				>
					<Link2 className="h-3 w-3" />
				</button>
				<CopyToast visible={copied === 'link'} />
			</div>
			{relativeTimestamp && (
				<span
					className="text-[11px] text-assistant-secondary tabular-nums self-center pl-p1"
					title={timestampTitle}
				>
					{relativeTimestamp}
				</span>
			)}
		</div>
	);
}

function extractTextFromLine(line: MessageSessionLine): string[] {
	const content = line.message?.content;
	if (!content) return [];
	if (typeof content === 'string') return [stripCommandTags(content)].filter(Boolean);
	return content
		.filter((b): b is SessionContentBlock & {text: string} => b.type === 'text' && typeof b.text === 'string')
		.map((b) => b.text);
}

function UserMessageActions({line, index, timestamp}: {line: MessageSessionLine; index: number; timestamp?: string}) {
	const [copied, setCopied] = useState<'text' | 'link' | null>(null);

	async function copyText() {
		const texts = extractTextFromLine(line);
		const ok = await writeClipboardText(texts.join('\n\n'));
		if (ok) {
			setCopied('text');
			setTimeout(() => setCopied(null), 1500);
		}
	}

	async function copyLink() {
		const url = `${window.location.origin}${window.location.pathname}#msg-${index}`;
		const ok = await writeClipboardText(url);
		if (ok) {
			setCopied('link');
			setTimeout(() => setCopied(null), 1500);
		}
	}

	const absoluteTimestamp = formatTimestamp(timestamp);
	const relativeTimestamp = formatRelativeTimestamp(timestamp);
	const timestampTitle = absoluteTimestamp ?? undefined;

	return (
		<div className="flex items-center gap-2 px-1 pt-0.5 text-[11px] text-text-500 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150">
			<div className="relative">
				<button
					type="button"
					title="Copy message"
					onClick={copyText}
					className="flex items-center gap-0.5 hover:text-text-000 cursor-pointer"
				>
					<Copy className="h-3 w-3" />
					<span>Copy</span>
				</button>
				<CopyToast visible={copied === 'text'} />
			</div>
			<div className="relative">
				<button
					type="button"
					title="Copy link"
					onClick={copyLink}
					className="flex items-center gap-0.5 hover:text-text-000 cursor-pointer"
				>
					<Link2 className="h-3 w-3" />
					<span>Link</span>
				</button>
				<CopyToast visible={copied === 'link'} />
			</div>
			{relativeTimestamp && (
				<span
					className="text-text-500"
					title={timestampTitle}
				>
					{relativeTimestamp}
				</span>
			)}
		</div>
	);
}

export const SessionChat = React.memo(function SessionChat({
	sessionId,
	lines,
	toolResultMap,
	subagentTree,
	showThinking = false,
	showTools = true,
	showPassedHooks = false,
	showHookWarnings = false,
	showHookErrors = false,
	showSystemBanners = false,
}: SessionChatProps) {
	const endRef = useRef<HTMLDivElement>(null);
	const subagentLookup = useMemo(() => buildSubagentLookup(subagentTree), [subagentTree]);
	const isSubagentSession = sessionId.startsWith('agent-');

	useEffect(() => {
		if (autoScrolledSessions.has(sessionId)) return;
		autoScrolledSessions.add(sessionId);
		requestAnimationFrame(() => {
			endRef.current?.scrollIntoView({block: 'end'});
		});
	}, [sessionId]);

	return (
		<div className="mx-auto w-full max-w-3xl px-8 pt-4 pb-4">
			<SessionLineList
				lines={lines}
				sessionId={sessionId}
				toolResultMap={toolResultMap}
				subagentLookup={subagentLookup}
				isSubagentSession={isSubagentSession}
				showThinking={showThinking}
				showTools={showTools}
				showPassedHooks={showPassedHooks}
				showHookWarnings={showHookWarnings}
				showHookErrors={showHookErrors}
				showSystemBanners={showSystemBanners}
			/>
			<div ref={endRef} />
		</div>
	);
});

/**
 * Build a set of line indices that should be skipped because they've been
 * coalesced into a preceding line (e.g., bash-output following bash-input).
 */
function buildSkipSet(lines: SessionLine[]): Set<number> {
	const skip = new Set<number>();
	for (let i = 0; i < lines.length - 1; i++) {
		const line = lines[i]!;
		const next = lines[i + 1]!;
		if (line.type === 'user' && next.type === 'user' && hasBashInput(line) && hasBashOutput(next)) {
			skip.add(i + 1);
		}
	}
	return skip;
}

interface LineRenderProps {
	sessionId: string;
	toolResultMap: Map<string, ToolResultInfo>;
	subagentLookup: ReturnType<typeof buildSubagentLookup>;
	isSubagentSession: boolean;
	showThinking: boolean;
	showTools: boolean;
	showPassedHooks: boolean;
	showHookWarnings: boolean;
	showHookErrors: boolean;
	showSystemBanners: boolean;
}

function LineEntry({
	line,
	index,
	nextLine,
	className,
	...renderProps
}: LineRenderProps & {
	line: SessionLine;
	index: number;
	nextLine: SessionLine | undefined;
	className?: string;
}) {
	const content = renderSessionMessage({line, index, ...renderProps, nextLine});
	if (!content) return null;

	const isAssistant = line.type === 'assistant';
	const rawTimestamp = getLineTimestamp(line);
	const absoluteTimestamp = formatTimestamp(rawTimestamp);
	const timestampTitle = absoluteTimestamp;
	return (
		<div
			key={`line-${index}`}
			id={`msg-${index}`}
			className={`${isAssistant ? 'group/msg flex flex-col w-full' : 'group relative'} ${className ?? ''}`}
			title={line.type !== 'user' ? (timestampTitle ?? undefined) : undefined}
		>
			{content}
			{isAssistant && (
				<MessageToolbar
					line={line}
					index={index}
					{...(rawTimestamp ? {timestamp: rawTimestamp} : {})}
				/>
			)}
		</div>
	);
}

function GroupedToolCallEntry({
	lines,
	indices,
	className,
	sessionId,
	toolResultMap,
	subagentLookup,
}: {
	lines: SessionLine[];
	indices: number[];
	className?: string;
	sessionId: string;
	toolResultMap: Map<string, ToolResultInfo>;
	subagentLookup: ReturnType<typeof buildSubagentLookup>;
}) {
	const allToolCalls = useMemo(
		() =>
			lines.flatMap((line) => {
				if (line.type !== 'assistant') return [];
				const content = line.message?.content;
				if (!Array.isArray(content)) return [];
				return content
					.filter((b): b is ToolUseBlock => b.type === 'tool_use')
					.map((block) => buildClientToolCall(block, line.uuid ?? '', toolResultMap, subagentLookup));
			}),
		[lines, toolResultMap, subagentLookup],
	);

	if (allToolCalls.length === 0) return null;

	return (
		<div
			id={`msg-${indices[0]}`}
			className={`group/msg flex flex-col w-full ${className ?? ''}`}
		>
			<ToolCallSection
				calls={allToolCalls}
				sessionId={sessionId}
			/>
		</div>
	);
}

const BANNER_LINE_TYPES = new Set(['agent-name', 'agent-color', 'permission-mode', 'pr-link', 'attachment']);

function isToolOnlyAssistantLine(line: SessionLine): boolean {
	if (line.type !== 'assistant') return false;
	const content = line.message?.content;
	if (!Array.isArray(content) || content.length === 0) return false;
	return content.every(
		(b) => b.type === 'tool_use' || (b.type === 'text' && (typeof b.text !== 'string' || b.text.trim() === '')),
	);
}

function isToolResultOnlyUserLine(line: SessionLine): boolean {
	if (line.type !== 'user') return false;
	const content = line.message?.content;
	if (!Array.isArray(content) || content.length === 0) return false;
	return content.every((b) => b.type === 'tool_result');
}

function SessionLineList({
	lines,
	...renderProps
}: LineRenderProps & {
	lines: SessionLine[];
}) {
	const skipSet = useMemo(() => buildSkipSet(lines), [lines]);

	const elements: React.ReactNode[] = [];
	let prevVisibleType: string | null = null;
	let i = 0;

	while (i < lines.length) {
		const line = lines[i]!;

		if (skipSet.has(i) || !isLineVisible(line, renderProps)) {
			i++;
			continue;
		}

		// Group consecutive tool-only assistant lines
		if (isToolOnlyAssistantLine(line) && renderProps.showTools) {
			const groupStart = i;
			const groupIndices: number[] = [i];
			let j = i + 1;
			while (j < lines.length) {
				const nextLine = lines[j]!;
				if (skipSet.has(j) || !isLineVisible(nextLine, renderProps)) {
					j++;
					continue;
				}
				if (isToolResultOnlyUserLine(nextLine)) {
					j++;
					continue;
				}
				if (isToolOnlyAssistantLine(nextLine)) {
					groupIndices.push(j);
					j++;
				} else {
					break;
				}
			}

			const isNewTurn = prevVisibleType !== null && prevVisibleType !== 'assistant';
			prevVisibleType = 'assistant';

			if (groupIndices.length === 1) {
				elements.push(
					<LineEntry
						key={`line-${groupStart}`}
						line={line}
						index={groupStart}
						nextLine={lines[groupStart + 1]}
						className={isNewTurn ? 'pb-6' : ''}
						{...renderProps}
					/>,
				);
			} else {
				elements.push(
					<GroupedToolCallEntry
						key={`group-${groupStart}`}
						lines={groupIndices.map((idx) => lines[idx]!)}
						indices={groupIndices}
						className={isNewTurn ? 'pb-6' : ''}
						{...renderProps}
					/>,
				);
			}
			i = j;
			continue;
		}

		const isNewTurn = prevVisibleType !== null && prevVisibleType !== line.type;
		const isBannerAfterBanner =
			BANNER_LINE_TYPES.has(line.type) && prevVisibleType !== null && BANNER_LINE_TYPES.has(prevVisibleType);

		prevVisibleType = line.type;

		elements.push(
			<LineEntry
				key={`line-${i}`}
				line={line}
				index={i}
				nextLine={lines[i + 1]}
				className={`${isNewTurn ? 'pb-6' : ''} ${isBannerAfterBanner ? 'mt-1' : ''}`}
				{...renderProps}
			/>,
		);
		i++;
	}

	return <>{elements}</>;
}

const HOOK_WARNING_SUBTYPES = new Set(['hook_non_blocking_error', 'hook_additional_context']);
const HOOK_ERROR_SUBTYPES = new Set(['hook_cancelled', 'hook_blocking_error']);
const SYSTEM_BANNER_SUBTYPES = new Set([
	'skill_listing',
	'command_permissions',
	'deferred_tools_delta',
	'mcp_instructions_delta',
	'date_change',
	'task_reminder',
	'companion_intro',
	'ultrathink_effort',
	'invoked_skills',
	'edited_text_file',
	'file',
	'directory',
	'compact_file_reference',
	'selected_lines_in_ide',
	'opened_file_in_ide',
]);

function getAttachmentSubtype(json: string): string | null {
	try {
		return (JSON.parse(json) as {type?: string}).type ?? null;
	} catch {
		return null;
	}
}

/**
 * Check whether an assistant line has content that will render.
 * Returns false when all content blocks are empty text, hidden thinking,
 * or tool_use blocks with showTools off -- avoiding blank rows.
 */
function hasAssistantVisibleContent(line: SessionLine, showThinking: boolean, showTools: boolean): boolean {
	if (line.type !== 'assistant') return true;
	const content = line.message?.content;
	if (!Array.isArray(content) || content.length === 0) return false;

	const hasText = content.some((b) => b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '');
	const hasThinking =
		showThinking &&
		content.some((b) => b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim() !== '');
	const hasMedia = content.some((b) => b.type === 'image' || b.type === 'document');
	const hasToolUse = showTools && content.some((b) => b.type === 'tool_use');

	return hasText || hasThinking || hasMedia || hasToolUse;
}

function isLineVisible(
	line: SessionLine,
	{
		showPassedHooks,
		showHookWarnings,
		showHookErrors,
		showSystemBanners,
		showThinking,
		showTools,
	}: Pick<
		LineRenderProps,
		'showPassedHooks' | 'showHookWarnings' | 'showHookErrors' | 'showSystemBanners' | 'showThinking' | 'showTools'
	>,
): boolean {
	if (line.type === 'agent-name' || line.type === 'agent-color' || line.type === 'permission-mode')
		return showSystemBanners;
	if (line.type === 'attachment') {
		const subtype = getAttachmentSubtype(line.attachmentJson);
		if (subtype === 'hook_success') return showPassedHooks;
		if (subtype && HOOK_WARNING_SUBTYPES.has(subtype)) return showHookWarnings;
		if (subtype && HOOK_ERROR_SUBTYPES.has(subtype)) return showHookErrors;
		if (subtype && SYSTEM_BANNER_SUBTYPES.has(subtype)) return showSystemBanners;
	}
	if (!hasAssistantVisibleContent(line, showThinking, showTools)) return false;
	return true;
}

/**
 * Top-level switching function: reads line.type and delegates to
 * per-type entry components. Returns null when there is nothing to render
 * (e.g. tool-only assistant turns with showTools off).
 * Not a React component — no hooks, so it is safe to call as a plain function
 * and inspect the return value before deciding whether to render the wrapper div.
 */
function renderSessionMessage({
	line,
	index,
	sessionId,
	toolResultMap,
	subagentLookup,
	isSubagentSession,
	showThinking,
	showTools,
	nextLine,
}: LineRenderProps & {
	line: SessionLine;
	index: number;
	nextLine?: SessionLine | undefined;
}) {
	if (line.type === 'user') {
		return (
			<UserEntry
				line={line}
				index={index}
				sessionId={sessionId}
				nextLine={nextLine}
				isSubagentSession={isSubagentSession}
			/>
		);
	}
	if (line.type === 'assistant') {
		return (
			<AssistantEntry
				line={line}
				sessionId={sessionId}
				toolResultMap={toolResultMap}
				subagentLookup={subagentLookup}
				showThinking={showThinking}
				showTools={showTools}
			/>
		);
	}
	if (line.type === 'agent-name') {
		return (
			<Banner
				icon={<Bot className="h-3.5 w-3.5" />}
				label={line.agentName}
			/>
		);
	}
	if (line.type === 'agent-color') {
		return (
			<Banner
				icon={<Palette className="h-3.5 w-3.5" />}
				label={`Agent color: ${line.agentColor}`}
			/>
		);
	}
	if (line.type === 'permission-mode') {
		return (
			<Banner
				icon={<Lock className="h-3.5 w-3.5" />}
				label={`Permission mode: ${line.permissionMode}`}
			/>
		);
	}
	if (line.type === 'pr-link') {
		return (
			<Banner icon={<Link className="h-3.5 w-3.5" />}>
				<a
					href={line.prUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="text-accent-500 hover:underline"
				>
					{line.prRepository}#{line.prNumber}
				</a>
			</Banner>
		);
	}
	if (line.type === 'attachment') {
		return (
			<AttachmentBanner
				attachmentJson={line.attachmentJson}
				sessionId={sessionId}
				uuid={line.uuid}
			/>
		);
	}
	return null;
}

function TruncatedContent({
	children,
	fadeColor,
	variant = 'default',
}: {
	children: React.ReactNode;
	fadeColor?: string;
	variant?: 'default' | 'user';
}) {
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
		return <div className="overflow-hidden">{children}</div>;
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
						style={{background: `linear-gradient(to bottom, transparent, ${fadeColor ?? 'var(--bg-100)'})`}}
					/>
				)}
			</div>
			{isTruncated && (
				<div className="mt-1 flex">
					<button
						type="button"
						onClick={() => setShowFull(true)}
						className={
							variant === 'user'
								? 'text-xs font-medium cursor-pointer rounded-full px-2 py-0.5 bg-accent-100/15 text-user-msg-text'
								: 'text-xs font-medium text-accent-100 hover:text-accent-000 cursor-pointer rounded-full bg-bg-200 px-2 py-0.5'
						}
					>
						Show more
					</button>
				</div>
			)}
		</div>
	);
}

/**
 * Classify a user line's content: is it a command, bash input/output, or regular text?
 */
function classifyUserContent(line: MessageSessionLine): 'command' | 'bash' | 'text' | 'tool-result-only' {
	const content = line.message?.content;
	if (!content) return 'text';

	if (typeof content === 'string') {
		if (parseCommandBlock(content)) return 'command';
		if (parseBashInput(content)) return 'bash';
		if (parseBashOutput(content)) return 'bash';
		return 'text';
	}

	// Array content: check for command or bash blocks, or tool_result only
	let hasCommand = false;
	let hasBash = false;
	let hasText = false;
	let hasToolResult = false;
	for (const block of content) {
		if (block.type === 'text' && typeof block.text === 'string') {
			if (parseCommandBlock(block.text)) hasCommand = true;
			else if (parseBashInput(block.text)) hasBash = true;
			else if (parseBashOutput(block.text)) hasBash = true;
			else if (/<local-command-caveat>/.test(block.text)) {
				// skip caveat blocks
			} else {
				const cleaned = stripCommandTags(block.text);
				if (cleaned) hasText = true;
			}
		} else if (block.type === 'tool_result') {
			hasToolResult = true;
		} else if (block.type === 'image' || block.type === 'document') {
			hasText = true;
		}
	}

	if (hasCommand) return 'command';
	if (hasBash) return 'bash';
	if (hasText) return 'text';
	if (hasToolResult) return 'tool-result-only';
	return 'text';
}

function UserEntry({
	line,
	index,
	sessionId,
	nextLine,
	isSubagentSession,
}: {
	line: MessageSessionLine;
	index: number;
	sessionId: string;
	nextLine?: SessionLine | undefined;
	isSubagentSession: boolean;
}) {
	const kind = classifyUserContent(line);

	if (kind === 'command') {
		return (
			<CommandEntry
				line={line}
				index={index}
				sessionId={sessionId}
			/>
		);
	}

	if (kind === 'bash') {
		const coalesceNext = hasBashInput(line) && nextLine?.type === 'user' && hasBashOutput(nextLine);
		return (
			<BashEntry
				line={line}
				outputLine={coalesceNext ? nextLine : undefined}
				sessionId={sessionId}
			/>
		);
	}

	if (kind === 'tool-result-only') {
		return null;
	}

	if (isSubagentSession) {
		return (
			<SubagentPromptEntry
				line={line}
				sessionId={sessionId}
			/>
		);
	}

	const isExternal = line.userType === 'external';

	if (isExternal) {
		return (
			<ExternalMessageEntry
				line={line}
				index={index}
				sessionId={sessionId}
			/>
		);
	}

	const timestamp = 'timestamp' in line ? line.timestamp : undefined;
	const actionsProps = {line, index, ...(timestamp ? {timestamp} : {})};
	const {textNodes, mediaNodes} = renderUserContentBlocks(line, sessionId);

	return (
		<div className="group/msg flex justify-start w-full">
			<div className="flex flex-col items-start gap-1 max-w-[75%] min-w-0">
				{textNodes.length > 0 && (
					<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-[10px] rounded-bl-[2px] bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-[13px] leading-[20px] select-text">
						{textNodes}
					</div>
				)}
				{mediaNodes}
				<UserMessageActions {...actionsProps} />
			</div>
		</div>
	);
}

function ExternalMessageEntry({line, index, sessionId}: {line: MessageSessionLine; index: number; sessionId: string}) {
	const timestamp = 'timestamp' in line ? line.timestamp : undefined;
	const actionsProps = {line, index, ...(timestamp ? {timestamp} : {})};
	const {textNodes, mediaNodes} = renderUserContentBlocks(line, sessionId);

	if (textNodes.length === 0 && mediaNodes.length === 0) return null;

	return (
		<div className="group/msg flex justify-start w-full">
			<div className="flex flex-col items-start gap-1 max-w-[85%] min-w-0">
				<div className="flex items-center gap-1.5 px-1">
					<span className="text-[10px] font-medium text-text-500 bg-bg-200 rounded-full px-2 py-0.5">
						Automated
					</span>
				</div>
				{textNodes.length > 0 && (
					<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-[10px] rounded-bl-[2px] bg-auto-msg-bg text-auto-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-[13px] leading-[20px] select-text">
						{textNodes}
					</div>
				)}
				{mediaNodes}
				<UserMessageActions {...actionsProps} />
			</div>
		</div>
	);
}

function SubagentPromptEntry({line, sessionId}: {line: MessageSessionLine; sessionId: string}) {
	const content = line.message?.content;
	if (!content) return null;

	const textBlocks: string[] = [];
	if (typeof content === 'string') {
		const cleaned = stripCommandTags(content);
		if (cleaned) textBlocks.push(cleaned);
	} else if (Array.isArray(content)) {
		for (const block of content) {
			if (block.type === 'text' && typeof block.text === 'string') {
				if (/<local-command-caveat>/.test(block.text)) continue;
				const cleaned = stripCommandTags(block.text);
				if (cleaned) textBlocks.push(cleaned);
			}
		}
	}

	if (textBlocks.length === 0) return null;

	return (
		<div className="flex flex-col gap-1.5 min-w-0">
			<div className="relative border-l-2 border-accent-100 pl-3">
				<div className="flex items-center gap-1.5 mb-1">
					<span className="text-[11px] font-medium text-accent-100 bg-accent-000/10 rounded-full px-2 py-0.5">
						&#x2191; Parent Agent
					</span>
				</div>
				<div className="text-sm leading-relaxed text-text-100">
					<TruncatedContent>
						<MarkdownArticle markdown={textBlocks.join('\n\n')} />
					</TruncatedContent>
				</div>
				<DebugLink
					sessionId={sessionId}
					uuid={line.uuid}
					className="absolute top-0 right-0"
				/>
			</div>
		</div>
	);
}

function lineMatchesBash(line: MessageSessionLine, parser: (text: string) => unknown): boolean {
	const content = line.message?.content;
	if (typeof content === 'string') return parser(content) !== null;
	if (Array.isArray(content)) {
		return content.some((b) => b.type === 'text' && typeof b.text === 'string' && parser(b.text) !== null);
	}
	return false;
}

function hasBashInput(line: MessageSessionLine): boolean {
	return lineMatchesBash(line, parseBashInput);
}

function hasBashOutput(line: MessageSessionLine): boolean {
	return lineMatchesBash(line, parseBashOutput);
}

interface UserContentBlocks {
	textNodes: React.ReactNode[];
	mediaNodes: React.ReactNode[];
}

function renderUserContentBlocks(line: MessageSessionLine, sessionId: string): UserContentBlocks {
	const content = line.message?.content;
	if (!content) return {textNodes: [], mediaNodes: []};

	if (typeof content === 'string') {
		const cleaned = stripCommandTags(content);
		if (!cleaned) return {textNodes: [], mediaNodes: []};
		return {
			textNodes: [
				<React.Fragment key={0}>
					<TruncatedContent
						fadeColor="var(--bg-100)"
						variant="user"
					>
						<MarkdownArticle markdown={cleaned} />
					</TruncatedContent>
					<DebugLink
						sessionId={sessionId}
						uuid={line.uuid}
						className="absolute top-1 right-1"
					/>
				</React.Fragment>,
			],
			mediaNodes: [],
		};
	}

	const textNodes: React.ReactNode[] = [];
	const mediaNodes: React.ReactNode[] = [];
	for (let i = 0; i < content.length; i++) {
		const block = content[i]!;
		if (block.type === 'text' && typeof block.text === 'string') {
			if (/<local-command-caveat>/.test(block.text)) continue;
			const cleaned = stripCommandTags(block.text);
			if (!cleaned) continue;
			textNodes.push(
				<React.Fragment key={`text-${i}`}>
					<TruncatedContent
						fadeColor="var(--bg-100)"
						variant="user"
					>
						<MarkdownArticle markdown={cleaned} />
					</TruncatedContent>
					<DebugLink
						sessionId={sessionId}
						uuid={line.uuid}
						className="absolute top-1 right-1"
					/>
				</React.Fragment>,
			);
		} else if (block.type === 'image' && block.source) {
			mediaNodes.push(
				<div
					key={`img-${i}`}
					className="relative inline-block"
				>
					<img
						src={`data:${block.source.media_type};base64,${block.source.data}`}
						alt="Session image"
						className="max-w-full max-h-96 rounded-lg border border-border-300/15 shadow-sm"
					/>
					<DebugLink
						sessionId={sessionId}
						uuid={line.uuid}
						className="absolute top-1 right-1"
					/>
				</div>,
			);
		} else if (block.type === 'document' && block.source) {
			mediaNodes.push(
				<div
					key={`doc-${i}`}
					className="relative rounded-lg px-3 py-2 bg-bg-100 text-text-000 flex items-center gap-1.5"
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
						uuid={line.uuid}
						className="absolute top-1 right-1"
					/>
				</div>,
			);
		}
		// tool_result blocks are intentionally skipped in user rendering
	}
	return {textNodes, mediaNodes};
}

function CommandEntry({line, index, sessionId}: {line: MessageSessionLine; index: number; sessionId: string}) {
	const content = line.message?.content;
	let cmdName = '';
	let cmdArgs: string | undefined;

	if (typeof content === 'string') {
		const cmd = parseCommandBlock(content);
		if (cmd) {
			cmdName = cmd.name;
			cmdArgs = cmd.args;
		}
	} else if (Array.isArray(content)) {
		for (const block of content) {
			if (block.type === 'text' && typeof block.text === 'string') {
				const cmd = parseCommandBlock(block.text);
				if (cmd) {
					cmdName = cmd.name;
					cmdArgs = cmd.args;
					break;
				}
			}
		}
	}

	const displayName = cmdName.startsWith('/') ? cmdName : `/${cmdName}`;
	const commandText = cmdArgs ? `${displayName} ${cmdArgs}` : displayName;

	const timestamp = 'timestamp' in line ? line.timestamp : undefined;
	const actionsProps = {line, index, ...(timestamp ? {timestamp} : {})};

	return (
		<div className="group/msg flex justify-start w-full">
			<div className="flex flex-col items-start gap-1 max-w-[75%] min-w-0">
				<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-[10px] rounded-bl-[2px] bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-[13px] leading-[20px] select-text">
					<TruncatedContent
						fadeColor="var(--bg-100)"
						variant="user"
					>
						<MarkdownArticle markdown={commandText} />
					</TruncatedContent>
					<DebugLink
						sessionId={sessionId}
						uuid={line.uuid}
						className="absolute top-1 right-1"
					/>
				</div>
				<UserMessageActions {...actionsProps} />
			</div>
		</div>
	);
}

function BashEntry({
	line,
	outputLine,
	sessionId,
}: {
	line: MessageSessionLine;
	outputLine?: MessageSessionLine | undefined;
	sessionId: string;
}) {
	let command = '';
	let stdout: string | undefined;
	let stderr: string | undefined;
	const outputUuid = outputLine?.uuid;

	function extractBash(content: string | SessionContentBlock[] | undefined) {
		if (!content) return;
		if (typeof content === 'string') {
			const bashIn = parseBashInput(content);
			if (bashIn) command = bashIn.command;
			const bashOut = parseBashOutput(content);
			if (bashOut) {
				stdout = bashOut.stdout;
				stderr = bashOut.stderr;
			}
		} else if (Array.isArray(content)) {
			for (const block of content) {
				if (block.type !== 'text' || typeof block.text !== 'string') continue;
				const bashIn = parseBashInput(block.text);
				if (bashIn) command = bashIn.command;
				const bashOut = parseBashOutput(block.text);
				if (bashOut) {
					stdout = bashOut.stdout;
					stderr = bashOut.stderr;
				}
			}
		}
	}

	extractBash(line.message?.content);
	if (outputLine) extractBash(outputLine.message?.content);

	if (!command && !stdout && !stderr) return null;

	return (
		<div className="flex flex-col items-end gap-1">
			<div className="relative rounded-lg p-2 bg-bg-100 text-text-000 max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] min-w-0">
				{command && (
					<div className="bg-bg-200 rounded px-2 py-1.5 font-mono text-xs flex items-start gap-2">
						<span className="text-text-500">! </span>
						<span className="text-success-000 break-all flex-1">{command}</span>
						<DebugLink
							sessionId={sessionId}
							uuid={line.uuid}
						/>
					</div>
				)}
				{stdout && (
					<div className="mt-1 relative">
						<TerminalOutput content={stdout} />
						<DebugLink
							sessionId={sessionId}
							uuid={outputUuid ?? line.uuid}
							className="absolute top-1 right-1"
						/>
					</div>
				)}
				{stderr && (
					<div className="mt-1 border-l-2 border-danger-000 bg-danger-000/10 rounded-r relative">
						<TerminalOutput content={stderr} />
						{!stdout && (
							<DebugLink
								sessionId={sessionId}
								uuid={outputUuid ?? line.uuid}
								className="absolute top-1 right-1"
							/>
						)}
					</div>
				)}
			</div>
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
					<ChevronIcon
						expanded={open}
						size={12}
					/>
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

/**
 * Renders an assistant JSONL line by iterating content blocks in original order.
 */
function AssistantEntry({
	line,
	sessionId,
	toolResultMap,
	subagentLookup,
	showThinking,
	showTools,
}: {
	line: MessageSessionLine;
	sessionId: string;
	toolResultMap: Map<string, ToolResultInfo>;
	subagentLookup: ReturnType<typeof buildSubagentLookup>;
	showThinking: boolean;
	showTools: boolean;
}) {
	const content = line.message?.content;

	if (!Array.isArray(content) || content.length === 0) {
		return null;
	}

	// Collect tool_use blocks for the tool summary and section
	const toolCalls = useMemo(
		() =>
			content
				.filter((b): b is ToolUseBlock => b.type === 'tool_use')
				.map((block) => buildClientToolCall(block, line.uuid ?? '', toolResultMap, subagentLookup)),
		[content, line, toolResultMap, subagentLookup],
	);
	const hasVisibleNonToolContent = content.some(
		(b) =>
			(b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') ||
			(b.type === 'thinking' && showThinking && typeof b.thinking === 'string' && b.thinking.trim() !== '') ||
			b.type === 'image' ||
			b.type === 'document',
	);
	const hasToolUse = toolCalls.length > 0;

	// No visible content at all -- hide the entry entirely
	if (!hasVisibleNonToolContent && !hasToolUse) {
		return null;
	}

	// Only tool_use blocks -- render as a tool call section
	if (!hasVisibleNonToolContent && hasToolUse) {
		if (!showTools) return null;
		return (
			<ToolCallSection
				calls={toolCalls}
				sessionId={sessionId}
			/>
		);
	}

	// Mixed content: render each block in original order
	return (
		<div className="flex flex-col gap-1.5 min-w-0">
			{content.map((block, i) => (
				<ContentBlock
					key={i}
					block={block}
					blockIndex={i}
					line={line}
					sessionId={sessionId}
					showThinking={showThinking}
					showTools={showTools}
					toolCalls={toolCalls}
				/>
			))}
		</div>
	);
}

/**
 * Switching component for individual content blocks within an assistant message.
 */
function ContentBlock({
	block,
	blockIndex,
	line,
	sessionId,
	showThinking,
	showTools,
	toolCalls,
}: {
	block: SessionContentBlock;
	blockIndex: number;
	line: MessageSessionLine;
	sessionId: string;
	showThinking: boolean;
	showTools: boolean;
	toolCalls: ClientToolCall[];
}) {
	if (block.type === 'text' && typeof block.text === 'string') {
		if (!block.text.trim()) return null;
		return (
			<div className="relative min-w-0 text-sm leading-relaxed text-text-100">
				<MarkdownArticle markdown={block.text} />
				<DebugLink
					sessionId={sessionId}
					uuid={line.uuid}
					className="absolute top-0 right-0"
				/>
			</div>
		);
	}

	if (block.type === 'thinking' && typeof block.thinking === 'string') {
		if (!showThinking || !block.thinking.trim()) return null;
		return (
			<ThinkingBlock
				thinking={block.thinking}
				sessionId={sessionId}
				sourceUuid={line.uuid}
			/>
		);
	}

	if (block.type === 'tool_use') {
		if (!showTools) return null;
		// Render the full tool call section when we hit the first tool_use block
		// (subsequent tool_use blocks in the same line are rendered as part of this section)
		const firstToolUseIndex = (line.message?.content as SessionContentBlock[]).findIndex(
			(b) => b.type === 'tool_use',
		);
		if (blockIndex !== firstToolUseIndex) return null;
		return (
			<ToolCallSection
				calls={toolCalls}
				sessionId={sessionId}
			/>
		);
	}

	if (block.type === 'image' && block.source) {
		return (
			<div className="relative inline-block">
				<img
					src={`data:${block.source.media_type};base64,${block.source.data}`}
					alt="Session image"
					className="max-w-full max-h-96 rounded-lg border border-border-300/15 shadow-sm"
				/>
				<DebugLink
					sessionId={sessionId}
					uuid={line.uuid}
					className="absolute top-1 right-1"
				/>
			</div>
		);
	}

	if (block.type === 'document' && block.source) {
		return (
			<div className="relative rounded-lg px-3 py-2 bg-bg-100 text-text-000 flex items-center gap-1.5">
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
					uuid={line.uuid}
					className="absolute top-1 right-1"
				/>
			</div>
		);
	}

	return null;
}

function toolCallVerb(name: string): string {
	if (name === 'Edit' || name === 'MultiEdit') return 'Edited';
	if (name === 'Write') return 'Wrote';
	if (name === 'Bash') return 'Ran';
	if (name === 'Read') return 'Read';
	if (name === 'Grep') return 'Searched';
	if (name === 'Glob') return 'Globbed';
	if (name === 'Agent') return 'Ran agent';
	if (name === 'WebFetch') return 'Fetched';
	if (name === 'WebSearch') return 'Searched web';
	if (name === 'ToolSearch') return 'Used ToolSearch';
	if (name === 'Skill') return 'Loaded skill';
	if (name === 'TaskCreate') return 'Created task';
	if (name === 'TaskUpdate') return 'Updated task';
	if (name === 'TaskGet') return 'Got task';
	if (name === 'TaskList') return 'Listed tasks';
	if (name === 'TaskStop') return 'Stopped task';
	if (name.startsWith('mcp__')) return formatToolName(name);
	return name;
}

const PROMINENT_TOOLS = new Set(['AskUserQuestion']);
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskStop']);

type ToolListItem = {kind: 'call'; call: ClientToolCall} | {kind: 'parallel'; key: string; calls: ClientToolCall[]};

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

function ToolCallSection({calls, sessionId}: {calls: ClientToolCall[]; sessionId: string}) {
	const prominentCalls = calls.filter((c) => PROMINENT_TOOLS.has(c.name));
	const backgroundCalls = calls.filter((c) => !PROMINENT_TOOLS.has(c.name));

	return (
		<>
			{backgroundCalls.length === 1 && (
				<ToolCallRow
					call={backgroundCalls[0]!}
					sessionId={sessionId}
				/>
			)}
			{backgroundCalls.length > 1 && (
				<ToolCallSummary
					calls={backgroundCalls}
					sessionId={sessionId}
				/>
			)}
			{prominentCalls.map((call, i) => {
				const Renderer = getToolRenderer(call.name);
				return (
					<div
						key={`prominent-${i}`}
						className="relative rounded-lg border border-border-300/15 bg-bg-000 p-4 text-sm shadow-sm"
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

/**
 * Tools whose param is a file path -- shown as filename-only in mono/primary style.
 */
const FILE_PARAM_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write']);

/**
 * Tools whose renderer body already displays the param (e.g. URL),
 * so we suppress it from the ToolCallRow header to avoid duplication.
 */
const RENDERER_HANDLES_PARAM = new Set([
	'ToolSearch',
	'mcp__claude-in-chrome__navigate',
	'mcp__chrome-devtools__navigate_page',
	'mcp__plugin_playwright_playwright__browser_navigate',
]);

/**
 * Tools whose renderer provides its own bg-t1 card shell (header + body).
 * These get a `group/body py-p6` wrapper with a `bg-t1 rounded-r6` inner div.
 *
 * All other tools (KeyValueCard-style) get `group/body relative flex flex-col w-full pt-p3`
 * with no inner wrapper, matching upstream claude.ai/code.
 */
const CARD_STYLE_TOOLS = new Set(['Bash', 'Read', 'Edit', 'MultiEdit', 'Write']);

/**
 * Tools that show inline diff stats (+N -M) in the clickable row.
 */
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit']);

/**
 * Compute diff stats from an Edit tool call's old_string / new_string input.
 */
function useEditDiffStats(call: ClientToolCall): {added: number; removed: number} | null {
	return useMemo(() => {
		if (!EDIT_TOOLS.has(call.name)) return null;
		const rawOldStr = call.input['old_string'];
		if (rawOldStr === undefined) return null;
		const oldStr = (rawOldStr as string) ?? '';
		const newStr = (call.input['new_string'] as string) ?? '';
		const data = computeDiffData(oldStr, newStr);
		return {added: data.added, removed: data.removed};
	}, [call.name, call.input]);
}

/**
 * Inline diff stats matching upstream claude.ai/code:
 *   span.inline-flex > span.flex.gap-g1 > span.text-extended-green "+N"
 *                                        > span.text-extended-pink  "-M"
 */
function InlineDiffStats({added, removed}: {added: number; removed: number}) {
	if (added === 0 && removed === 0) return null;
	return (
		<span className="inline-flex">
			<span className="flex gap-g1 items-center text-body shrink-0">
				{added > 0 && <span className="text-extended-green">+{added}</span>}
				{removed > 0 && <span className="text-extended-pink">-{removed}</span>}
			</span>
		</span>
	);
}

function ToolCallRow({call, sessionId}: {call: ClientToolCall; sessionId: string}) {
	const [expanded, setExpanded] = useState(false);
	const Renderer = getToolRenderer(call.name);
	const verb = toolCallVerb(call.name);
	const isFileParam = FILE_PARAM_TOOLS.has(call.name);
	const diffStats = useEditDiffStats(call);
	const isCardStyle = CARD_STYLE_TOOLS.has(call.name);

	const displayParam = RENDERER_HANDLES_PARAM.has(call.name)
		? ''
		: isFileParam
			? (call.param.split('/').pop() ?? call.param)
			: call.param;

	return (
		<div className="flex flex-col w-full">
			<div
				role="button"
				tabIndex={0}
				onClick={() => setExpanded(!expanded)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						setExpanded(!expanded);
					}
				}}
				className="relative group/tool flex self-start max-w-full items-center py-0 gap-g2 text-left cursor-pointer hide-focus-ring rounded-r3"
			>
				<span className="shrink-0 text-body text-assistant-secondary">{verb}</span>
				{displayParam && (
					<span
						className={`truncate min-w-0 ${isFileParam ? 'text-code text-assistant-primary' : 'text-body text-assistant-secondary'}`}
					>
						{displayParam}
					</span>
				)}
				{diffStats && (
					<InlineDiffStats
						added={diffStats.added}
						removed={diffStats.removed}
					/>
				)}
				<span className="shrink-0 text-assistant-secondary">
					<ChevronIcon
						expanded={expanded}
						size={14}
					/>
				</span>
			</div>
			<div className={`grid ${expanded ? 'grid-rows-expand' : 'grid-rows-collapse'}`}>
				<div className="overflow-hidden">
					{isCardStyle ? (
						<div className="group/body py-p6">
							<div className="bg-t1 rounded-r6 overflow-clip flex flex-col relative">
								<Renderer toolCall={call} />
								<DebugLink
									sessionId={sessionId}
									uuid={call.sourceUuid}
									className="absolute top-1 right-1"
								/>
							</div>
						</div>
					) : (
						<div className="group/body relative flex flex-col w-full pt-p3">
							<Renderer toolCall={call} />
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function ParallelGroupInline({calls, sessionId}: {calls: ClientToolCall[]; sessionId: string}) {
	const size = calls.length;

	return (
		<div className="min-w-0 py-0.5">
			<div className="flex items-center gap-1.5 text-[12px] text-text-500 mb-1">
				<span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-accent-000/12 text-accent-100">
					parallel &times;{size}
				</span>
			</div>
			<div className="ml-2 pl-2 border-l border-accent-000/20">
				{calls.map((call, i) => (
					<ToolCallRow
						key={i}
						call={call}
						sessionId={sessionId}
					/>
				))}
			</div>
		</div>
	);
}

/**
 * Renders the structured summary as verb spans matching upstream claude.ai/code:
 *   <span class="text-body text-assistant-secondary">{verb}</span>
 *   <span class="text-assistant-secondary"> {rest}</span>
 * with commas between segments.
 */
function SummarySpans({segments}: {segments: SummarySegment[]}) {
	return (
		<>
			{segments.map((segment, i) => (
				<React.Fragment key={i}>
					{i > 0 && <span className="text-assistant-secondary">, </span>}
					<span className="text-body text-assistant-secondary">{segment.verb}</span>
					<span className="text-assistant-secondary"> {segment.rest}</span>
				</React.Fragment>
			))}
		</>
	);
}

function ToolCallSummary({calls, sessionId}: {calls: ClientToolCall[]; sessionId: string}) {
	const [expanded, setExpanded] = useState(false);
	const taskCalls = calls.filter((c) => TASK_TOOLS.has(c.name));
	const hasTasksView = taskCalls.length >= 3;
	const displayCalls = hasTasksView ? calls.filter((c) => !TASK_TOOLS.has(c.name)) : calls;
	const items = groupParallelSubagents(displayCalls);
	const segments = useMemo(() => summarizeToolCallsStructured(displayCalls), [displayCalls]);

	return (
		<div className="flex flex-col w-full">
			{hasTasksView && (
				<div className="mb-2">
					<TasksView toolCalls={calls} />
				</div>
			)}
			{displayCalls.length > 0 && (
				<>
					<button
						type="button"
						onClick={() => setExpanded(!expanded)}
						className="relative group/tool flex self-start max-w-full items-center py-0 gap-g1 text-left hide-focus-ring rounded-r3"
					>
						<span className="inline-flex items-center gap-g3 min-w-0">
							<span className="text-body truncate min-w-0">
								<SummarySpans segments={segments} />
							</span>
						</span>
						<span className="shrink-0 text-assistant-secondary">
							<ChevronIcon
								expanded={expanded}
								size={14}
							/>
						</span>
					</button>
					<div className={`grid ${expanded ? 'grid-rows-expand' : 'grid-rows-collapse'}`}>
						<div className="overflow-hidden">
							<div className="flex flex-col gap-g3 bg-t1 rounded-r6 p-p7 mt-p3">
								{items.map((item, i) => {
									if (item.kind === 'parallel') {
										return (
											<ParallelGroupInline
												key={`pg-${item.key}`}
												calls={item.calls}
												sessionId={sessionId}
											/>
										);
									}
									return (
										<ToolCallRow
											key={i}
											call={item.call}
											sessionId={sessionId}
										/>
									);
								})}
							</div>
						</div>
					</div>
				</>
			)}
		</div>
	);
}
