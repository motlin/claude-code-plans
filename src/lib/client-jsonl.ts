/**
 * Client-side JSONL line interpretation.
 *
 * Processes raw JSONL records into SessionLine entries and ToolResultInfo
 * for rendering. Used both for initial transcript loading and for SSE
 * incremental appends.
 */

import type {MessageSessionLine, SessionContentBlock, SessionLine, ToolResultInfo} from './sessions';
import {extractToolResultContent, stripResultTags, truncateResult} from './session-utils';

interface InterpretedLines {
	newSessionLines: SessionLine[];
	newToolResults: Map<string, ToolResultInfo>;
}

/**
 * Interpret raw JSONL objects into SessionLines and ToolResultInfo entries.
 *
 * Mirrors the filtering/pairing logic from readSessionLines():
 * - Produces SessionLine entries for rendering-relevant record types
 *   (user, assistant, agent-name, agent-color, permission-mode, pr-link, attachment)
 * - Pairs tool_use blocks (in assistant messages) with tool_result blocks (in user messages)
 * - Extracts timestamps and computes tool durations
 * - Strips system-reminder tags and truncates long results
 *
 * @param rawLines - Raw JSON objects from the JSONL file or SSE event
 * @param startLineIndex - The JSONL line index to start counting from (for appending to existing lines)
 */
export function interpretJsonlLines(rawLines: Record<string, unknown>[], startLineIndex: number): InterpretedLines {
	const newSessionLines: SessionLine[] = [];
	const newToolResults = new Map<string, ToolResultInfo>();
	const toolStartTimes = new Map<string, number>();

	for (let i = 0; i < rawLines.length; i++) {
		const obj = rawLines[i]!;
		const lineIndex = startLineIndex + i;
		const type = obj['type'] as string;
		const uuid = typeof obj['uuid'] === 'string' ? obj['uuid'] : undefined;

		// Track tool_use start times from assistant messages
		if (type === 'assistant') {
			const message = obj['message'] as {content?: SessionContentBlock[]} | undefined;
			const timestamp = typeof obj['timestamp'] === 'string' ? obj['timestamp'] : undefined;
			if (Array.isArray(message?.content)) {
				for (const block of message.content) {
					if (block.type === 'tool_use' && block.id) {
						if (timestamp) {
							const t = new Date(timestamp).getTime();
							if (!isNaN(t)) toolStartTimes.set(block.id, t);
						}
					}
				}
			}
		}

		// Pair tool_result blocks from user messages with their tool_use
		if (type === 'user') {
			const message = obj['message'] as {content?: string | SessionContentBlock[]} | undefined;
			const timestamp = typeof obj['timestamp'] === 'string' ? obj['timestamp'] : undefined;
			if (Array.isArray(message?.content)) {
				for (const block of message.content as SessionContentBlock[]) {
					if (block.type === 'tool_result' && block.tool_use_id) {
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
							newToolResults.set(block.tool_use_id, info);
						}
					}
				}
			}
		}

		// Non-message line types
		if (type === 'agent-name') {
			const agentName = obj['agentName'];
			if (typeof agentName === 'string') {
				newSessionLines.push({type: 'agent-name', agentName, lineIndex});
			}
			continue;
		}
		if (type === 'agent-color') {
			const agentColor = obj['agentColor'];
			if (typeof agentColor === 'string') {
				newSessionLines.push({type: 'agent-color', agentColor, lineIndex});
			}
			continue;
		}
		if (type === 'permission-mode') {
			const permissionMode = obj['permissionMode'];
			if (typeof permissionMode === 'string') {
				newSessionLines.push({type: 'permission-mode', permissionMode, lineIndex});
			}
			continue;
		}
		if (type === 'pr-link') {
			const prUrl = obj['prUrl'];
			const prNumber = obj['prNumber'];
			const prRepository = obj['prRepository'];
			const timestamp = obj['timestamp'];
			if (typeof prUrl === 'string' && typeof prNumber === 'number' && typeof prRepository === 'string') {
				newSessionLines.push({
					type: 'pr-link',
					prUrl,
					prNumber,
					prRepository,
					...(typeof timestamp === 'string' ? {timestamp} : {}),
					lineIndex,
				});
			}
			continue;
		}
		if (type === 'attachment') {
			const attachment = obj['attachment'];
			const timestamp = obj['timestamp'];
			if (attachment !== undefined) {
				newSessionLines.push({
					type: 'attachment',
					attachmentJson: JSON.stringify(attachment),
					...(uuid !== undefined ? {uuid} : {}),
					...(typeof timestamp === 'string' ? {timestamp} : {}),
					lineIndex,
				});
			}
			continue;
		}

		// Only include user/assistant lines for the rendering tree
		if (type !== 'user' && type !== 'assistant') continue;

		const sessionLine: MessageSessionLine = {
			type: type as 'user' | 'assistant',
			lineIndex,
		};
		if (uuid !== undefined) sessionLine.uuid = uuid;
		const parentUuid = obj['parentUuid'];
		if (typeof parentUuid === 'string') sessionLine.parentUuid = parentUuid;
		const timestamp = obj['timestamp'];
		if (typeof timestamp === 'string') sessionLine.timestamp = timestamp;
		const message = obj['message'] as {role?: string; content?: string | SessionContentBlock[]} | undefined;
		if (message) sessionLine.message = message;

		newSessionLines.push(sessionLine);
	}

	return {newSessionLines, newToolResults};
}
