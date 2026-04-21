import type {SessionLine} from './sessions';
import {summarizeToolCalls} from './session-utils';
import type {ToolCallInfo} from './sessions';

export interface GroupedLine {
	kind: 'line';
	line: SessionLine;
	/** Original index in the lines array */
	index: number;
}

export interface AssistantGroup {
	kind: 'group';
	lines: SessionLine[];
	/** Original index of the first line in the group */
	startIndex: number;
	/** Human-readable summary of tool calls in this group */
	summary: string;
	/** Total number of tool_use blocks across all lines in the group */
	toolCallCount: number;
}

export type GroupedEntry = GroupedLine | AssistantGroup;

/**
 * Extract tool call info from an assistant line's content blocks.
 */
function extractToolCalls(line: SessionLine): ToolCallInfo[] {
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
 * Groups consecutive assistant lines between user lines into collapsible
 * AssistantGroup entries. Single assistant lines between user lines are
 * kept as standalone GroupedLine entries (no grouping overhead for simple
 * Q&A exchanges).
 */
export function groupAssistantMessages(lines: SessionLine[]): GroupedEntry[] {
	if (lines.length === 0) return [];

	const result: GroupedEntry[] = [];
	let assistantRun: SessionLine[] = [];
	let assistantRunStart = 0;

	function flushAssistantRun() {
		if (assistantRun.length === 0) return;

		if (assistantRun.length === 1) {
			result.push({kind: 'line', line: assistantRun[0]!, index: assistantRunStart});
		} else {
			const allToolCalls: ToolCallInfo[] = [];
			for (const assistantLine of assistantRun) {
				allToolCalls.push(...extractToolCalls(assistantLine));
			}
			result.push({
				kind: 'group',
				lines: assistantRun,
				startIndex: assistantRunStart,
				summary: summarizeToolCalls(allToolCalls),
				toolCallCount: allToolCalls.length,
			});
		}
		assistantRun = [];
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.type === 'assistant') {
			if (assistantRun.length === 0) {
				assistantRunStart = i;
			}
			assistantRun.push(line);
		} else {
			flushAssistantRun();
			result.push({kind: 'line', line, index: i});
		}
	}
	flushAssistantRun();

	return result;
}
