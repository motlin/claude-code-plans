/**
 * Shared transcript processing library.
 *
 * Processes raw JSONL records into rendering data. Works identically in
 * Node (for indexing) and browser (for rendering) -- no Node-specific imports.
 *
 * Core function: processTranscript(records) returns ProcessedTranscript.
 * Incremental function: processNewRecords(records, startIndex) for SSE appends.
 */

import type {MessageSessionLine, SessionLine, ToolResultInfo} from './sessions';
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
// Types
// ---------------------------------------------------------------------------

export interface ProcessedTranscript {
	lines: SessionLine[];
	toolResultMap: Map<string, ToolResultInfo>;
	uuidToLine: Map<string, number>;
	title: string;
	customTitle: string | undefined;
}

interface IncrementalResult {
	newSessionLines: SessionLine[];
	newToolResults: Map<string, ToolResultInfo>;
}

// ---------------------------------------------------------------------------
// Internal processing logic
// ---------------------------------------------------------------------------

interface AttachmentSessionLine {
	type: 'attachment';
	attachmentJson: string;
	uuid?: string | undefined;
	timestamp?: string | undefined;
	lineIndex: number;
}

function processRecordBatch(
	records: unknown[],
	startLineIndex: number,
	uuidToLine?: Map<string, number>,
): {
	sessionLines: SessionLine[];
	toolResults: Map<string, ToolResultInfo>;
	title: string;
	customTitle: string | undefined;
} {
	const sessionLines: SessionLine[] = [];
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
			const prLine: SessionLine & {type: 'pr-link'} = {
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
			const attachmentLine: AttachmentSessionLine = {
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

		const sessionLine: MessageSessionLine = {
			type: record.type,
			lineIndex,
		};
		if (uuid !== undefined) sessionLine.uuid = uuid;
		if (typeof record.parentUuid === 'string') sessionLine.parentUuid = record.parentUuid;
		if (record.timestamp !== undefined) sessionLine.timestamp = record.timestamp;
		// The Zod-parsed message is structurally compatible with MessageSessionLine.message
		// but uses Record<string, unknown> for tool input vs SerializableValue.
		// Cast is safe because the runtime data is identical.
		sessionLine.message = record.message as MessageSessionLine['message'];

		sessionLines.push(sessionLine);
	}

	return {sessionLines, toolResults, title, customTitle};
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
 * merging into existing state. Replaces interpretJsonlLines() from client-jsonl.ts.
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
