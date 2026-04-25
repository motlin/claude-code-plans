/**
 * Shared transcript processing library.
 *
 * Processes raw JSONL records into rendering data. Works identically in
 * Node (for indexing) and browser (for rendering) -- no Node-specific imports.
 *
 * Core function: processTranscript(records) returns ProcessedTranscript.
 * Incremental function: processNewRecords(records, startIndex) for SSE appends.
 */

import type {ToolResultInfo} from './sessions';
import type {ContentBlock} from './schemas';
import {JsonlRecordSchema} from './schemas';

// ---------------------------------------------------------------------------
// Re-exported shared helpers (moved from session-utils.ts)
// ---------------------------------------------------------------------------

const COMMAND_MESSAGE_RE = /<command-message[^>]*>([\s\S]*?)<\/command-message>/;
const STRIP_BLOCK_RE =
	/<(?:command-name|command-args|local-command-stdout)[^>]*>[\s\S]*?<\/(?:command-name|command-args|local-command-stdout)>/g;
const STRIP_TAG_RE =
	/<\/?(?:command-message|command-name|command-args|command|local-command-caveat|local-command-stdout)[^>]*>/g;

function cleanCommandText(text: string): string {
	const msgMatch = text.match(COMMAND_MESSAGE_RE);
	if (msgMatch) {
		return msgMatch[1]!.replace(STRIP_TAG_RE, '').trim();
	}
	return text.replace(STRIP_BLOCK_RE, '').replace(STRIP_TAG_RE, '').trim();
}

/**
 * Strip command-related XML tags from user message text.
 */
export function stripCommandTags(text: string): string {
	return cleanCommandText(text);
}

/**
 * Extract text from a tool_result content field.
 * Content can be a plain string or an array of {type: 'text', text: string} blocks.
 */
export function extractToolResultContent(content: unknown): string | undefined {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		const texts: string[] = [];
		for (const item of content) {
			if (typeof item === 'object' && item !== null && 'type' in item && 'text' in item) {
				const block = item as {type: string; text: string};
				if (block.type === 'text' && typeof block.text === 'string') {
					texts.push(block.text);
				}
			}
		}
		return texts.length > 0 ? texts.join('\n') : undefined;
	}
	return undefined;
}

/**
 * Strip non-rendering wrapper tags from tool result text.
 */
export function stripResultTags(text: string): string {
	let result = text;
	result = result.replace(/<\/?tool_use_error>/g, '');
	result = result.replace(/<\/?persisted-output>/g, '');
	result = result.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
	if (result !== text) result = result.trim();
	return result;
}

/**
 * Truncate text to a maximum number of lines, appending a count of omitted lines.
 */
export function truncateResult(text: string, maxLines: number): string {
	const lines = text.split('\n');
	if (lines.length <= maxLines) return text;
	const truncated = lines.slice(0, maxLines);
	truncated.push(`... (${lines.length - maxLines} more lines)`);
	return truncated.join('\n');
}

/**
 * Extract a display title from user prompt text.
 */
export function extractSessionTitle(text: string, fallback?: string): string {
	const cleaned = cleanCommandText(text);
	if (!cleaned) return fallback ?? 'Untitled Session';

	if (cleaned.length <= 80) return cleaned;

	const truncated = cleaned.slice(0, 80);
	const lastSpace = truncated.lastIndexOf(' ');
	if (lastSpace > 40) {
		return truncated.slice(0, lastSpace) + '...';
	}
	return truncated + '...';
}

// ---------------------------------------------------------------------------
// ProcessedLine types -- derived from Zod schemas with lineIndex added
// ---------------------------------------------------------------------------

/**
 * A user or assistant message line for rendering.
 * The message field uses the Zod-inferred ContentBlock type directly
 * instead of the old SerializableContentBlock intermediate shape.
 */
export interface MessageProcessedLine {
	type: 'user' | 'assistant';
	uuid?: string | undefined;
	parentUuid?: string | undefined;
	timestamp?: string | undefined;
	message?:
		| {
				role?: string | undefined;
				content?: string | ContentBlock[] | undefined;
		  }
		| undefined;
	customTitle?: string | undefined;
	sessionId?: string | undefined;
	lineIndex: number;
}

interface AgentNameProcessedLine {
	type: 'agent-name';
	agentName: string;
	lineIndex: number;
}

interface AgentColorProcessedLine {
	type: 'agent-color';
	agentColor: string;
	lineIndex: number;
}

interface PermissionModeProcessedLine {
	type: 'permission-mode';
	permissionMode: string;
	lineIndex: number;
}

interface PrLinkProcessedLine {
	type: 'pr-link';
	prUrl: string;
	prNumber: number;
	prRepository: string;
	timestamp?: string | undefined;
	lineIndex: number;
}

interface AttachmentProcessedLine {
	type: 'attachment';
	attachmentJson: string;
	uuid?: string | undefined;
	timestamp?: string | undefined;
	lineIndex: number;
}

/**
 * A single processed JSONL line for rendering. Discriminated union on `type`.
 * Derived from the Zod schema types in schemas.ts with `lineIndex` added.
 */
export type ProcessedLine =
	| MessageProcessedLine
	| AgentNameProcessedLine
	| AgentColorProcessedLine
	| PermissionModeProcessedLine
	| PrLinkProcessedLine
	| AttachmentProcessedLine;

// Re-export the Zod-inferred ContentBlock for consumers that need it
export type {ContentBlock} from './schemas';

// Backwards-compatible aliases for gradual migration
export type SessionLine = ProcessedLine;
export type MessageSessionLine = MessageProcessedLine;
export type SessionContentBlock = ContentBlock;
export type AttachmentSessionLine = AttachmentProcessedLine;

// ---------------------------------------------------------------------------
// Transcript result types
// ---------------------------------------------------------------------------

export interface ProcessedTranscript {
	lines: ProcessedLine[];
	toolResultMap: Map<string, ToolResultInfo>;
	uuidToLine: Map<string, number>;
	title: string;
	customTitle: string | undefined;
}

interface IncrementalResult {
	newSessionLines: ProcessedLine[];
	newToolResults: Map<string, ToolResultInfo>;
}

// ---------------------------------------------------------------------------
// Command group deduplication
// ---------------------------------------------------------------------------

const COMMAND_NAME_RE = /<command-name>/;
const LOCAL_COMMAND_CAVEAT_RE = /^<local-command-caveat>/;
const LOCAL_COMMAND_STDOUT_RE = /^<local-command-stdout>/;

/**
 * Get the string content of a user message line, if it has string content.
 */
function getUserStringContent(line: ProcessedLine): string | undefined {
	if (line.type !== 'user') return undefined;
	const content = line.message?.content;
	if (typeof content === 'string') return content;
	return undefined;
}

/**
 * Check whether a user message line is a slash command (contains `<command-name>`).
 */
function isCommandLine(line: ProcessedLine): boolean {
	const text = getUserStringContent(line);
	return text !== undefined && COMMAND_NAME_RE.test(text);
}

/**
 * Check whether a user message line is a local-command-caveat.
 */
function isCaveatLine(line: ProcessedLine): boolean {
	const text = getUserStringContent(line);
	return text !== undefined && LOCAL_COMMAND_CAVEAT_RE.test(text);
}

/**
 * Check whether a user message line is a local-command-stdout.
 */
function isStdoutLine(line: ProcessedLine): boolean {
	const text = getUserStringContent(line);
	return text !== undefined && LOCAL_COMMAND_STDOUT_RE.test(text);
}

/**
 * Remove duplicate consecutive command groups from processed lines.
 *
 * A "command group" is an optional caveat line, followed by a command line,
 * followed by an optional stdout line. When two adjacent command groups have
 * identical command content, the second group is removed.
 */
function deduplicateCommandGroups(lines: ProcessedLine[]): ProcessedLine[] {
	const indicesToRemove = new Set<number>();
	let lastCommandContent: string | undefined;
	let lastCommandGroupEnd = -1;

	for (let i = 0; i < lines.length; i++) {
		if (!isCommandLine(lines[i]!)) {
			// Non-command lines that aren't part of a command group reset tracking,
			// unless they're caveats or stdouts adjacent to a command.
			if (!isCaveatLine(lines[i]!) && !isStdoutLine(lines[i]!)) {
				lastCommandContent = undefined;
				lastCommandGroupEnd = -1;
			}
			continue;
		}

		const commandContent = getUserStringContent(lines[i]!)!;

		// Determine the boundaries of this command group
		const groupStart = i > 0 && isCaveatLine(lines[i - 1]!) ? i - 1 : i;
		const groupEnd = i + 1 < lines.length && isStdoutLine(lines[i + 1]!) ? i + 1 : i;

		if (commandContent === lastCommandContent && groupStart <= lastCommandGroupEnd + 1) {
			// Duplicate command group -- mark for removal
			for (let j = groupStart; j <= groupEnd; j++) {
				indicesToRemove.add(j);
			}
		} else {
			lastCommandContent = commandContent;
		}
		lastCommandGroupEnd = groupEnd;
	}

	if (indicesToRemove.size === 0) return lines;
	return lines.filter((_, index) => !indicesToRemove.has(index));
}

function processRecordBatch(
	records: unknown[],
	startLineIndex: number,
	uuidToLine?: Map<string, number>,
): {
	sessionLines: ProcessedLine[];
	toolResults: Map<string, ToolResultInfo>;
	title: string;
	customTitle: string | undefined;
} {
	const sessionLines: ProcessedLine[] = [];
	const toolResults = new Map<string, ToolResultInfo>();
	const toolStartTimes = new Map<string, number>();
	let title = '';
	let customTitle: string | undefined;

	for (let i = 0; i < records.length; i++) {
		const obj = records[i]!;
		const lineIndex = startLineIndex + i;

		const parsed = JsonlRecordSchema.safeParse(obj);
		if (!parsed.success) continue;
		const record = parsed.data;

		const uuid = 'uuid' in record && typeof record.uuid === 'string' ? record.uuid : undefined;
		if (uuid && uuidToLine) uuidToLine.set(uuid, lineIndex);

		if (record.type === 'custom-title') {
			customTitle = record.customTitle;
			continue;
		}

		// Extract title from first user text
		if (record.type === 'user' && !title) {
			const {content} = record.message;
			if (typeof content === 'string') {
				const cleaned = stripCommandTags(content);
				if (cleaned) title = extractSessionTitle(cleaned);
			} else if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === 'text') {
						const cleaned = stripCommandTags(block.text);
						if (cleaned) {
							title = extractSessionTitle(cleaned);
							break;
						}
					}
				}
			}
		}

		// Track tool_use start times from assistant messages
		if (record.type === 'assistant') {
			const {content} = record.message;
			const timestamp = record.timestamp;
			if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === 'tool_use') {
						if (timestamp) {
							const t = new Date(timestamp).getTime();
							if (!isNaN(t)) toolStartTimes.set(block.id, t);
						}
					}
				}
			}
		}

		// Pair tool_result blocks from user messages
		if (record.type === 'user') {
			const {content} = record.message;
			const timestamp = record.timestamp;
			if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === 'tool_result') {
						const rawResult = extractToolResultContent(block.content);
						if (rawResult !== undefined) {
							const resultText = stripResultTags(rawResult);
							const info: ToolResultInfo = {
								result: truncateResult(resultText, 150),
								isError: block.is_error === true,
								resultUuid: uuid ?? '',
							};
							const startTime = toolStartTimes.get(block.tool_use_id);
							if (startTime && timestamp) {
								const resultTime = new Date(timestamp).getTime();
								if (!isNaN(resultTime) && resultTime > startTime) {
									info.duration = resultTime - startTime;
								}
							}
							toolResults.set(block.tool_use_id, info);
						}
					}
				}
			}
		}

		// Non-message rendering line types
		if (record.type === 'agent-name') {
			sessionLines.push({type: 'agent-name', agentName: record.agentName, lineIndex});
			continue;
		}
		if (record.type === 'agent-color') {
			sessionLines.push({type: 'agent-color', agentColor: record.agentColor, lineIndex});
			continue;
		}
		if (record.type === 'permission-mode') {
			sessionLines.push({type: 'permission-mode', permissionMode: record.permissionMode, lineIndex});
			continue;
		}
		if (record.type === 'pr-link') {
			const prLine: PrLinkProcessedLine = {
				type: 'pr-link',
				prUrl: record.prUrl,
				prNumber: record.prNumber,
				prRepository: record.prRepository,
				lineIndex,
			};
			if (record.timestamp !== undefined) prLine.timestamp = record.timestamp;
			sessionLines.push(prLine);
			continue;
		}

		if (record.type === 'attachment') {
			const attachmentLine: AttachmentProcessedLine = {
				type: 'attachment',
				attachmentJson: JSON.stringify(record.attachment),
				lineIndex,
			};
			if (uuid !== undefined) attachmentLine.uuid = uuid;
			if (record.timestamp !== undefined) attachmentLine.timestamp = record.timestamp;
			sessionLines.push(attachmentLine);
			continue;
		}

		// Only include user/assistant lines for the rendering tree
		if (record.type !== 'user' && record.type !== 'assistant') continue;

		const processedLine: MessageProcessedLine = {
			type: record.type,
			lineIndex,
		};
		if (uuid !== undefined) processedLine.uuid = uuid;
		if (typeof record.parentUuid === 'string') processedLine.parentUuid = record.parentUuid;
		if (record.timestamp !== undefined) processedLine.timestamp = record.timestamp;
		// The Zod-parsed message uses the ContentBlock type directly --
		// no intermediate serialization type needed.
		processedLine.message = record.message as MessageProcessedLine['message'];

		sessionLines.push(processedLine);
	}

	return {sessionLines: deduplicateCommandGroups(sessionLines), toolResults, title, customTitle};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process raw JSONL records into rendering data.
 *
 * Takes the raw JSON objects from the transcript API and returns everything
 * the renderer needs: lines, toolResultMap, uuidToLine, title, customTitle.
 */
export function processTranscript(records: unknown[]): ProcessedTranscript {
	const uuidToLine = new Map<string, number>();
	const {sessionLines, toolResults, title, customTitle} = processRecordBatch(records, 0, uuidToLine);
	return {
		lines: sessionLines,
		toolResultMap: toolResults,
		uuidToLine,
		title,
		customTitle,
	};
}

/**
 * Process new JSONL records incrementally for SSE appends.
 *
 * Same processing logic as processTranscript but returns data shaped for
 * merging into existing state.
 *
 * @param records - Raw JSON objects from the SSE event
 * @param startIndex - The JSONL line index to start counting from
 */
export function processNewRecords(records: unknown[], startIndex: number): IncrementalResult {
	const {sessionLines, toolResults} = processRecordBatch(records, startIndex);
	return {
		newSessionLines: sessionLines,
		newToolResults: toolResults,
	};
}
