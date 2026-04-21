import type {SessionLine, SessionContentBlock} from '../src/lib/sessions';
import {groupAssistantMessages, type AssistantGroup, type GroupedLine} from '../src/lib/assistant-groups';

function userLine(index: number, text: string): SessionLine {
	return {
		type: 'user',
		uuid: `uuid-${index}`,
		lineIndex: index,
		message: {role: 'user', content: text},
	};
}

function assistantTextLine(index: number, text: string): SessionLine {
	return {
		type: 'assistant',
		uuid: `uuid-${index}`,
		lineIndex: index,
		message: {role: 'assistant', content: [{type: 'text', text}]},
	};
}

function assistantToolLine(
	index: number,
	tools: Array<{id: string; name: string; input: Record<string, unknown>}>,
): SessionLine {
	const blocks: SessionContentBlock[] = tools.map((t) => ({
		type: 'tool_use' as const,
		id: t.id,
		name: t.name,
		input: t.input as SessionContentBlock['input'],
	}));
	return {
		type: 'assistant',
		uuid: `uuid-${index}`,
		lineIndex: index,
		message: {role: 'assistant', content: blocks},
	};
}

function assistantMixedLine(
	index: number,
	text: string,
	tools: Array<{id: string; name: string; input: Record<string, unknown>}>,
): SessionLine {
	const blocks: SessionContentBlock[] = [
		{type: 'text', text},
		...tools.map((t) => ({
			type: 'tool_use' as const,
			id: t.id,
			name: t.name,
			input: t.input as SessionContentBlock['input'],
		})),
	];
	return {
		type: 'assistant',
		uuid: `uuid-${index}`,
		lineIndex: index,
		message: {role: 'assistant', content: blocks},
	};
}

describe('groupAssistantMessages', () => {
	it('returns empty array for empty input', () => {
		expect(groupAssistantMessages([])).toEqual([]);
	});

	it('wraps a single user line as a standalone entry', () => {
		const lines = [userLine(0, 'hello')];
		const result = groupAssistantMessages(lines);
		expect(result).toHaveLength(1);
		expect(result[0]!.kind).toBe('line');
		expect((result[0] as GroupedLine).line).toBe(lines[0]);
	});

	it('wraps a single assistant line as a standalone entry (not grouped)', () => {
		const lines = [assistantTextLine(0, 'hi there')];
		const result = groupAssistantMessages(lines);
		expect(result).toHaveLength(1);
		expect(result[0]!.kind).toBe('line');
	});

	it('groups consecutive assistant lines between user lines', () => {
		const lines = [
			userLine(0, 'do something'),
			assistantTextLine(1, 'thinking...'),
			assistantToolLine(2, [{id: 't1', name: 'Read', input: {file_path: '/foo.ts'}}]),
			assistantToolLine(3, [
				{id: 't2', name: 'Edit', input: {file_path: '/foo.ts', old_string: 'a', new_string: 'b'}},
			]),
			assistantTextLine(4, 'done!'),
			userLine(5, 'thanks'),
		];
		const result = groupAssistantMessages(lines);

		expect(result).toHaveLength(3);
		// User line
		expect(result[0]!.kind).toBe('line');
		expect((result[0] as GroupedLine).line.type).toBe('user');

		// Assistant group with 4 lines
		expect(result[1]!.kind).toBe('group');
		const group = result[1] as AssistantGroup;
		expect(group.lines).toHaveLength(4);
		expect(group.lines[0]).toBe(lines[1]);
		expect(group.lines[3]).toBe(lines[4]);

		// User line
		expect(result[2]!.kind).toBe('line');
		expect((result[2] as GroupedLine).line.type).toBe('user');
	});

	it('does not group a single assistant line between user lines', () => {
		const lines = [userLine(0, 'hi'), assistantTextLine(1, 'hello'), userLine(2, 'bye')];
		const result = groupAssistantMessages(lines);
		expect(result).toHaveLength(3);
		expect(result[0]!.kind).toBe('line');
		expect(result[1]!.kind).toBe('line');
		expect(result[2]!.kind).toBe('line');
	});

	it('generates summary from tool calls in the group', () => {
		const lines = [
			userLine(0, 'refactor code'),
			assistantToolLine(1, [{id: 't1', name: 'Read', input: {file_path: '/a.ts'}}]),
			assistantToolLine(2, [
				{id: 't2', name: 'Edit', input: {file_path: '/a.ts', old_string: 'x', new_string: 'y'}},
			]),
			assistantToolLine(3, [
				{id: 't3', name: 'Edit', input: {file_path: '/b.ts', old_string: 'p', new_string: 'q'}},
			]),
			assistantToolLine(4, [{id: 't4', name: 'Bash', input: {command: 'npm test', description: 'run tests'}}]),
			userLine(5, 'ok'),
		];
		const result = groupAssistantMessages(lines);
		const group = result[1] as AssistantGroup;
		expect(group.kind).toBe('group');
		expect(group.summary).toContain('edited');
		expect(group.summary).toContain('read');
		expect(group.summary).toContain('bash');
	});

	it('handles multiple groups in a conversation', () => {
		const lines = [
			userLine(0, 'first task'),
			assistantTextLine(1, 'working...'),
			assistantToolLine(2, [{id: 't1', name: 'Read', input: {file_path: '/a.ts'}}]),
			userLine(3, 'second task'),
			assistantTextLine(4, 'on it...'),
			assistantToolLine(5, [{id: 't2', name: 'Bash', input: {command: 'ls', description: 'list files'}}]),
			assistantTextLine(6, 'done'),
		];
		const result = groupAssistantMessages(lines);

		expect(result).toHaveLength(4);
		expect(result[0]!.kind).toBe('line'); // user
		expect(result[1]!.kind).toBe('group'); // assistant group 1
		expect(result[2]!.kind).toBe('line'); // user
		expect(result[3]!.kind).toBe('group'); // assistant group 2
		expect((result[1] as AssistantGroup).lines).toHaveLength(2);
		expect((result[3] as AssistantGroup).lines).toHaveLength(3);
	});

	it('includes startIndex for each group', () => {
		const lines = [userLine(0, 'go'), assistantTextLine(1, 'a'), assistantTextLine(2, 'b'), userLine(3, 'next')];
		const result = groupAssistantMessages(lines);
		const group = result[1] as AssistantGroup;
		expect(group.startIndex).toBe(1);
	});

	it('handles assistant-only conversations (no user messages at all)', () => {
		const lines = [assistantTextLine(0, 'first'), assistantTextLine(1, 'second'), assistantTextLine(2, 'third')];
		const result = groupAssistantMessages(lines);
		expect(result).toHaveLength(1);
		expect(result[0]!.kind).toBe('group');
		expect((result[0] as AssistantGroup).lines).toHaveLength(3);
	});

	it('treats metadata record types as non-assistant (breaks assistant runs)', () => {
		const metadataLine: SessionLine = {
			type: 'agent-name',
			lineIndex: 2,
			agentName: 'git-replay-automation',
		};
		const lines = [
			userLine(0, 'do it'),
			assistantTextLine(1, 'working...'),
			metadataLine,
			assistantTextLine(3, 'more work'),
			userLine(4, 'done'),
		];
		const result = groupAssistantMessages(lines);
		// user, assistant (standalone), metadata, assistant (standalone), user
		expect(result).toHaveLength(5);
		expect(result[0]!.kind).toBe('line');
		expect((result[0] as GroupedLine).line.type).toBe('user');
		expect(result[1]!.kind).toBe('line');
		expect((result[1] as GroupedLine).line.type).toBe('assistant');
		expect(result[2]!.kind).toBe('line');
		expect((result[2] as GroupedLine).line.type).toBe('agent-name');
		expect(result[3]!.kind).toBe('line');
		expect((result[3] as GroupedLine).line.type).toBe('assistant');
		expect(result[4]!.kind).toBe('line');
		expect((result[4] as GroupedLine).line.type).toBe('user');
	});

	it('treats attachment lines as non-assistant (breaks assistant runs)', () => {
		const attachmentLine: SessionLine = {
			type: 'attachment',
			lineIndex: 2,
			attachmentJson: JSON.stringify({type: 'date_change', newDate: '2026-04-21'}),
		};
		const lines = [
			userLine(0, 'start'),
			assistantTextLine(1, 'working...'),
			attachmentLine,
			assistantTextLine(3, 'more work'),
			userLine(4, 'done'),
		];
		const result = groupAssistantMessages(lines);
		// user, assistant (standalone), attachment, assistant (standalone), user
		expect(result).toHaveLength(5);
		expect((result[2] as GroupedLine).line.type).toBe('attachment');
	});

	it('collects tool call info from mixed content blocks', () => {
		const lines = [
			userLine(0, 'work'),
			assistantMixedLine(1, 'let me check', [{id: 't1', name: 'Grep', input: {pattern: 'TODO'}}]),
			assistantMixedLine(2, 'found it', [
				{id: 't2', name: 'Edit', input: {file_path: '/x.ts', old_string: 'a', new_string: 'b'}},
			]),
			userLine(3, 'thanks'),
		];
		const result = groupAssistantMessages(lines);
		const group = result[1] as AssistantGroup;
		expect(group.kind).toBe('group');
		expect(group.toolCallCount).toBe(2);
	});
});
