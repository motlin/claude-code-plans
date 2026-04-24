import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Copy, Link2} from 'lucide-react';
import {MarkdownArticle} from './markdown-article';
import {getToolRenderer} from './tool-renderers';
import {buildClientToolCall, buildSubagentLookup} from './tool-renderers/types';
import type {ClientToolCall, SerializedToolResultMap} from './tool-renderers';
import {ChevronIcon, DurationBadge, TerminalOutput} from './tool-renderers/shared';
import {TasksView} from './tasks-view';
import {DebugLink} from './debug-link';
import {hmrPersist} from '../lib/hmr-persist';
import type {MessageSessionLine, SessionLine, SessionContentBlock, ToolResultInfo} from '../lib/sessions';
import type {SubagentTreeEntry} from '../lib/db/queries';
import {AttachmentBanner, Banner} from './attachment-banner';
import {stripCommandTags, parseCommandBlock, parseBashInput, parseBashOutput} from '../lib/session-utils';
import {groupAssistantMessages, type AssistantGroup} from '../lib/assistant-groups';
import {AssistantMessageGroupHeader, useGroupExpansion} from './assistant-message-group';

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

export interface SessionChatProps {
	sessionId: string;
	lines: SessionLine[];
	toolResultMap: SerializedToolResultMap;
	subagentTree: SubagentTreeEntry[];
	showThinking?: boolean;
	showTools?: boolean;
	showPassedHooks?: boolean;
	showHookErrors?: boolean;
	showSystemBanners?: boolean;
	showTimestamps?: boolean;
}

const autoScrolledSessions = hmrPersist('autoScrolledSessions', () => new Set<string>());

function CopyToast({visible}: {visible: boolean}) {
	return (
		<span
			className={`absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-bg-200 px-1.5 py-0.5 text-[10px] text-text-300 shadow-sm transition-opacity whitespace-nowrap ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
		>
			Copied!
		</span>
	);
}

function MessageToolbar({line, index}: {line: MessageSessionLine; index: number}) {
	const [copied, setCopied] = useState<'text' | 'link' | null>(null);

	function copyText() {
		const texts = extractTextFromLine(line);
		navigator.clipboard.writeText(texts.join('\n\n'));
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

function extractTextFromLine(line: MessageSessionLine): string[] {
	const content = line.message?.content;
	if (!content) return [];
	if (typeof content === 'string') return [stripCommandTags(content)].filter(Boolean);
	return content
		.filter((b): b is SessionContentBlock & {text: string} => b.type === 'text' && typeof b.text === 'string')
		.map((b) => b.text);
}

export const SessionChat = React.memo(function SessionChat({
	sessionId,
	lines,
	toolResultMap: serializedToolResultMap,
	subagentTree,
	showThinking = false,
	showTools = true,
	showPassedHooks = false,
	showHookErrors = false,
	showSystemBanners = false,
	showTimestamps = false,
}: SessionChatProps) {
	const endRef = useRef<HTMLDivElement>(null);

	const toolResultMap = useMemo(() => new Map(serializedToolResultMap), [serializedToolResultMap]);
	const subagentLookup = useMemo(() => buildSubagentLookup(subagentTree), [subagentTree]);

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
				showThinking={showThinking}
				showTools={showTools}
				showPassedHooks={showPassedHooks}
				showHookErrors={showHookErrors}
				showSystemBanners={showSystemBanners}
				showTimestamps={showTimestamps}
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
	showThinking: boolean;
	showTools: boolean;
	showPassedHooks: boolean;
	showHookErrors: boolean;
	showSystemBanners: boolean;
	showTimestamps: boolean;
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
	const content = renderSessionMessage({line, ...renderProps, nextLine});
	if (!content) return null;

	const isMessage = line.type === 'user' || line.type === 'assistant';
	return (
		<div
			key={`line-${index}`}
			id={`msg-${index}`}
			className={`group relative ${className ?? ''}`}
		>
			{isMessage && (
				<MessageToolbar
					line={line}
					index={index}
				/>
			)}
			{content}
		</div>
	);
}

function SessionLineList({
	lines,
	...renderProps
}: LineRenderProps & {
	lines: SessionLine[];
}) {
	const skipSet = useMemo(() => buildSkipSet(lines), [lines]);
	const grouped = useMemo(() => groupAssistantMessages(lines), [lines]);

	return (
		<>
			{grouped.map((entry, groupIndex) => {
				if (entry.kind === 'line') {
					const i = entry.index;
					if (skipSet.has(i)) return null;
					if (!isLineVisible(entry.line, renderProps)) return null;
					const prevRole = i > 0 ? lines[i - 1]!.type : null;
					const isNewTurn = prevRole !== null && prevRole !== lines[i]!.type;

					return (
						<LineEntry
							key={`line-${i}`}
							line={entry.line}
							index={i}
							nextLine={lines[i + 1]}
							className={isNewTurn ? 'pb-6' : ''}
							{...renderProps}
						/>
					);
				}

				return (
					<AssistantGroupSection
						key={`group-${groupIndex}`}
						group={entry}
						lines={lines}
						skipSet={skipSet}
						{...renderProps}
					/>
				);
			})}
		</>
	);
}

function AssistantGroupSection({
	group,
	lines,
	skipSet,
	...renderProps
}: LineRenderProps & {
	group: AssistantGroup;
	lines: SessionLine[];
	skipSet: Set<number>;
}) {
	const [expanded, onToggle] = useGroupExpansion(group);

	return (
		<div
			id={`msg-${group.startIndex}`}
			className="pb-6"
		>
			<AssistantMessageGroupHeader
				group={group}
				expanded={expanded}
				onToggle={onToggle}
			/>
			<div className={`grid ${expanded ? 'grid-rows-expand' : 'grid-rows-collapse'}`}>
				<div className="overflow-hidden">
					{group.lines.map((line, lineOffset) => {
						const i = group.lineIndices[lineOffset]!;
						if (skipSet.has(i)) return null;
						if (!isLineVisible(line, renderProps)) return null;

						return (
							<LineEntry
								key={`line-${i}`}
								line={line}
								index={i}
								nextLine={lines[i + 1]}
								{...renderProps}
							/>
						);
					})}
				</div>
			</div>
		</div>
	);
}

const HOOK_ERROR_SUBTYPES = new Set(['hook_non_blocking_error', 'hook_cancelled', 'hook_additional_context']);
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

function isLineVisible(
	line: SessionLine,
	{
		showPassedHooks,
		showHookErrors,
		showSystemBanners,
	}: Pick<LineRenderProps, 'showPassedHooks' | 'showHookErrors' | 'showSystemBanners'>,
): boolean {
	if (line.type === 'agent-name' || line.type === 'agent-color' || line.type === 'permission-mode')
		return showSystemBanners;
	if (line.type === 'attachment') {
		const subtype = getAttachmentSubtype(line.attachmentJson);
		if (subtype === 'hook_success') return showPassedHooks;
		if (subtype && HOOK_ERROR_SUBTYPES.has(subtype)) return showHookErrors;
		if (subtype && SYSTEM_BANNER_SUBTYPES.has(subtype)) return showSystemBanners;
	}
	return true;
}

/**
 * Top-level switching function: reads line.type and delegates to
 * per-type entry components. Returns null when there is nothing to render
 * (e.g. tool-only assistant turns with both showTools and showTimestamps off).
 * Not a React component — no hooks, so it is safe to call as a plain function
 * and inspect the return value before deciding whether to render the wrapper div.
 */
function renderSessionMessage({
	line,
	sessionId,
	toolResultMap,
	subagentLookup,
	showThinking,
	showTools,
	showTimestamps,
	nextLine,
}: LineRenderProps & {
	line: SessionLine;
	nextLine?: SessionLine | undefined;
}) {
	if (line.type === 'user') {
		return (
			<UserEntry
				line={line}
				sessionId={sessionId}
				nextLine={nextLine}
				showTimestamps={showTimestamps}
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
				showTimestamps={showTimestamps}
			/>
		);
	}
	if (line.type === 'agent-name') {
		return (
			<Banner
				icon="🤖"
				label={line.agentName}
			/>
		);
	}
	if (line.type === 'agent-color') {
		return (
			<Banner
				icon="🎨"
				label={`Agent color: ${line.agentColor}`}
			/>
		);
	}
	if (line.type === 'permission-mode') {
		return (
			<Banner
				icon="🔒"
				label={`Permission mode: ${line.permissionMode}`}
			/>
		);
	}
	if (line.type === 'pr-link') {
		return (
			<Banner icon="🔗">
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
		return <AttachmentBanner attachmentJson={line.attachmentJson} />;
	}
	return null;
}

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
	sessionId,
	nextLine,
	showTimestamps,
}: {
	line: MessageSessionLine;
	sessionId: string;
	nextLine?: SessionLine | undefined;
	showTimestamps: boolean;
}) {
	const timestampText = formatTimestamp(line.timestamp);
	const kind = classifyUserContent(line);

	if (kind === 'command') {
		return (
			<CommandEntry
				line={line}
				sessionId={sessionId}
				timestampText={timestampText}
				showTimestamps={showTimestamps}
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
				timestampText={timestampText}
				showTimestamps={showTimestamps}
			/>
		);
	}

	if (kind === 'tool-result-only') {
		return null;
	}

	return (
		<div className="flex flex-col items-end gap-1.5">
			{renderUserContentBlocks(line, sessionId)}
			{showTimestamps && <Timestamp value={timestampText} />}
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

function renderUserContentBlocks(line: MessageSessionLine, sessionId: string): React.ReactNode[] {
	const content = line.message?.content;
	if (!content) return [];

	if (typeof content === 'string') {
		const cleaned = stripCommandTags(content);
		if (!cleaned) return [];
		return [
			<div
				key={0}
				className="relative rounded-lg px-3 py-2 break-words min-w-0 overflow-hidden bg-bg-100 text-text-000 max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] text-sm leading-relaxed"
			>
				<TruncatedContent>
					<MarkdownArticle markdown={cleaned} />
				</TruncatedContent>
				<DebugLink
					sessionId={sessionId}
					uuid={line.uuid}
					className="absolute top-1 right-1"
				/>
			</div>,
		];
	}

	const nodes: React.ReactNode[] = [];
	for (let i = 0; i < content.length; i++) {
		const block = content[i]!;
		if (block.type === 'text' && typeof block.text === 'string') {
			if (/<local-command-caveat>/.test(block.text)) continue;
			const cleaned = stripCommandTags(block.text);
			if (!cleaned) continue;
			nodes.push(
				<div
					key={`text-${i}`}
					className="relative rounded-lg px-3 py-2 break-words min-w-0 overflow-hidden bg-bg-100 text-text-000 max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] text-sm leading-relaxed"
				>
					<TruncatedContent>
						<MarkdownArticle markdown={cleaned} />
					</TruncatedContent>
					<DebugLink
						sessionId={sessionId}
						uuid={line.uuid}
						className="absolute top-1 right-1"
					/>
				</div>,
			);
		} else if (block.type === 'image' && block.source) {
			// User-attached images (screenshots etc.)
			nodes.push(
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
			nodes.push(
				<div
					key={`doc-${i}`}
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
						uuid={line.uuid}
						className="absolute top-1 right-1"
					/>
				</div>,
			);
		}
		// tool_result blocks are intentionally skipped in user rendering
	}
	return nodes;
}

function CommandEntry({
	line,
	sessionId,
	timestampText,
	showTimestamps,
}: {
	line: MessageSessionLine;
	sessionId: string;
	timestampText: string | null;
	showTimestamps: boolean;
}) {
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

	return (
		<div className="flex flex-col items-end gap-1">
			<div className="relative rounded-lg px-3 py-2 bg-bg-100 text-text-000 max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%]">
				<span className="bg-bg-200 rounded-full px-2 py-0.5 text-xs font-mono">{cmdName}</span>
				{cmdArgs && <span className="text-xs text-text-500 ml-1.5">{cmdArgs}</span>}
				<DebugLink
					sessionId={sessionId}
					uuid={line.uuid}
					className="absolute top-1 right-1"
				/>
			</div>
			{showTimestamps && <Timestamp value={timestampText} />}
		</div>
	);
}

function BashEntry({
	line,
	outputLine,
	sessionId,
	timestampText,
	showTimestamps,
}: {
	line: MessageSessionLine;
	outputLine?: MessageSessionLine | undefined;
	sessionId: string;
	timestampText: string | null;
	showTimestamps: boolean;
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
			{showTimestamps && <Timestamp value={timestampText} />}
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
	showTimestamps,
}: {
	line: MessageSessionLine;
	sessionId: string;
	toolResultMap: Map<string, ToolResultInfo>;
	subagentLookup: ReturnType<typeof buildSubagentLookup>;
	showThinking: boolean;
	showTools: boolean;
	showTimestamps: boolean;
}) {
	const content = line.message?.content;
	const timestampText = formatTimestamp(line.timestamp);

	if (!Array.isArray(content) || content.length === 0) {
		return showTimestamps ? <Timestamp value={timestampText} /> : null;
	}

	// Collect tool_use blocks for the tool summary and section
	const toolCalls = useMemo(
		() =>
			content
				.filter((b) => b.type === 'tool_use')
				.map((block) => buildClientToolCall(block, line, toolResultMap, subagentLookup)),
		[content, line, toolResultMap, subagentLookup],
	);
	// Determine if all content is just tool_use (render as grouped tool section)
	// vs mixed content (render in order)
	const hasVisibleNonToolContent = content.some(
		(b) =>
			b.type === 'text' || (b.type === 'thinking' && showThinking) || b.type === 'image' || b.type === 'document',
	);
	const hasToolUse = toolCalls.length > 0;

	// If there's only tool_use blocks, render as a tool call section
	if (!hasVisibleNonToolContent && hasToolUse) {
		if (!showTools && !showTimestamps) return null;
		return (
			<div className="flex flex-col gap-1.5 min-w-0">
				{showTools && (
					<ToolCallSection
						calls={toolCalls}
						sessionId={sessionId}
					/>
				)}
				{showTimestamps && <Timestamp value={timestampText} />}
			</div>
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
			{showTimestamps && <Timestamp value={timestampText} />}
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
		if (!showThinking) return null;
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

const PROMINENT_TOOLS = new Set(['AskUserQuestion']);
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList']);

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
			{backgroundCalls.length > 0 && (
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

function ToolCallRow({call, sessionId}: {call: ClientToolCall; sessionId: string}) {
	const Renderer = getToolRenderer(call.name);
	return (
		<div className="min-w-0 py-0.5 text-sm leading-relaxed text-text-500">
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

function ToolCallSummary({calls, sessionId}: {calls: ClientToolCall[]; sessionId: string}) {
	const taskCalls = calls.filter((c) => TASK_TOOLS.has(c.name));
	const hasTasksView = taskCalls.length >= 3;
	const displayCalls = hasTasksView ? calls.filter((c) => !TASK_TOOLS.has(c.name)) : calls;
	const items = groupParallelSubagents(displayCalls);

	return (
		<div className="min-w-0">
			{hasTasksView && (
				<div className="mb-2">
					<TasksView toolCalls={calls} />
				</div>
			)}
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
	);
}
