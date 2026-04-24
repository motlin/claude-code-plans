import type {MessageSessionLine, SessionLine} from './sessions';
import {summarizeToolCalls} from './session-utils';
import type {ToolCallInfo} from './sessions';

export interface GroupedLine {
	kind: 'line';
	line: SessionLine;
	/** Original index in the lines array */
	index: number;
}

export interface TailText {
	line: MessageSessionLine;
	lineIndex: number;
	/** Indices of content blocks that are text (type === 'text' with non-empty .text) */
	textBlockIndices: number[];
}

export interface AssistantGroup {
	kind: 'group';
	/** All lines in this span (mixed types: assistant, agent-name, attachment, etc.) */
	lines: SessionLine[];
	/** Original indices of each line */
	lineIndices: number[];
	/** Only the assistant-type lines from this span */
	assistantLines: MessageSessionLine[];
	/** Original index of the first line in the group (backward compat) */
	startIndex: number;
	/** Human-readable summary of tool calls in this group */
	summary: string;
	/** Total number of tool_use blocks across all lines in the group */
	toolCallCount: number;
	/** Last text content to show outside the collapsed section, or null if no text */
	tailText: TailText | null;
}

export type GroupedEntry = GroupedLine | AssistantGroup;

/**
 * Extract tool call info from an assistant line's content blocks.
 */
function extractToolCalls(line: MessageSessionLine): ToolCallInfo[] {
	const content = line.message?.content;
	if (!Array.isArray(content)) return [];

	const calls: ToolCallInfo[] = [];
	for (const block of content) {
		if (block.type === 'tool_use') {
			calls.push({
				id: block.id ?? '',
				name: block.name ?? '',
				input: (block.input as Record<string, unknown>) ?? {},
				sourceUuid: line.uuid ?? '',
			});
		}
	}
	return calls;
}

/**
 * Extract tail text from a span of assistant lines.
 * Iterates in reverse to find the last assistant line with non-empty text blocks.
 */
function extractTailText(assistantLines: MessageSessionLine[]): TailText | null {
	for (let i = assistantLines.length - 1; i >= 0; i--) {
		const line = assistantLines[i]!;
		const content = line.message?.content;
		if (!Array.isArray(content)) continue;

		const textBlockIndices: number[] = [];
		for (let blockIndex = 0; blockIndex < content.length; blockIndex++) {
			const block = content[blockIndex]!;
			if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
				textBlockIndices.push(blockIndex);
			}
		}

		if (textBlockIndices.length > 0) {
			return {
				line,
				lineIndex: line.lineIndex,
				textBlockIndices,
			};
		}
	}
	return null;
}

/**
 * Determine whether a span of non-user lines qualifies as a simple Q&A
 * (should be emitted as a GroupedLine instead of an AssistantGroup).
 *
 * Criteria: exactly one line total, it is an assistant line with text content
 * and no tool_use blocks.
 */
function isSimpleQA(span: SessionLine[]): boolean {
	if (span.length !== 1) return false;
	const line = span[0]!;
	if (line.type !== 'assistant') return false;
	const content = line.message?.content;
	if (!Array.isArray(content)) return typeof content === 'string';
	const hasText = content.some(
		(block) => block.type === 'text' && typeof block.text === 'string' && block.text.length > 0,
	);
	const hasTool = content.some((block) => block.type === 'tool_use');
	return hasText && !hasTool;
}

/**
 * Groups all non-user lines between user lines into collapsible
 * AssistantGroup entries. User lines are delimiters.
 *
 * Exception: if the span contains only one assistant line with text
 * and no tool calls (simple Q&A), it is emitted as a GroupedLine.
 */
export function groupAssistantMessages(lines: SessionLine[]): GroupedEntry[] {
	if (lines.length === 0) return [];

	const result: GroupedEntry[] = [];
	let span: SessionLine[] = [];
	let spanIndices: number[] = [];

	function flushSpan() {
		if (span.length === 0) return;

		if (span.length === 1 && (isSimpleQA(span) || span[0]!.type !== 'assistant')) {
			result.push({kind: 'line', line: span[0]!, index: spanIndices[0]!});
			span = [];
			spanIndices = [];
			return;
		}

		const assistantLines: MessageSessionLine[] = [];
		for (const line of span) {
			if (line.type === 'assistant') {
				assistantLines.push(line);
			}
		}

		const allToolCalls: ToolCallInfo[] = [];
		for (const assistantLine of assistantLines) {
			allToolCalls.push(...extractToolCalls(assistantLine));
		}

		result.push({
			kind: 'group',
			lines: span,
			lineIndices: spanIndices,
			assistantLines,
			startIndex: spanIndices[0]!,
			summary: summarizeToolCalls(allToolCalls),
			toolCallCount: allToolCalls.length,
			tailText: extractTailText(assistantLines),
		});

		span = [];
		spanIndices = [];
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.type === 'user') {
			flushSpan();
			result.push({kind: 'line', line, index: i});
		} else {
			span.push(line);
			spanIndices.push(i);
		}
	}
	flushSpan();

	return result;
}
