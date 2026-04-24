import type {SessionLine, SessionContentBlock, MessageSessionLine} from '../src/lib/sessions';
import {
	groupAssistantMessages,
	type AssistantGroup,
	type GroupedLine,
	type TailText,
} from '../src/lib/assistant-groups';

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

function agentNameLine(index: number, name: string): SessionLine {
	return {type: 'agent-name', lineIndex: index, agentName: name};
}

function attachmentLine(index: number, payload: Record<string, unknown>): SessionLine {
	return {type: 'attachment', lineIndex: index, attachmentJson: JSON.stringify(payload)};
}

function permissionModeLine(index: number, mode: string): SessionLine {
	return {type: 'permission-mode', lineIndex: index, permissionMode: mode};
}

function prLinkLine(index: number): SessionLine {
	return {
		type: 'pr-link',
		lineIndex: index,
		prUrl: 'https://github.com/org/repo/pull/1',
		prNumber: 1,
		prRepository: 'org/repo',
	};
}

describe('groupAssistantMessages', () => {
	it('returns empty array for empty input', () => {
		expect(groupAssistantMessages([])).toStrictEqual([]);
	});

	it('wraps a single user line as a standalone entry', () => {
		const lines = [userLine(0, 'hello')];
		const result = groupAssistantMessages(lines);
		expect(result.map((r) => r.kind)).toStrictEqual(['line']);
		expect((result[0] as GroupedLine).line).toBe(lines[0]);
	});

	it('emits a single text-only assistant line as GroupedLine (simple Q&A)', () => {
		const lines = [userLine(0, 'hi'), assistantTextLine(1, 'hello there'), userLine(2, 'bye')];
		const result = groupAssistantMessages(lines);
		expect(result.map((r) => r.kind)).toStrictEqual(['line', 'line', 'line']);
		expect((result[1] as GroupedLine).line).toBe(lines[1]);
		expect((result[1] as GroupedLine).index).toBe(1);
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

		expect(result.map((r) => r.kind)).toStrictEqual(['line', 'group', 'line']);
		expect((result[0] as GroupedLine).line.type).toBe('user');

		const group = result[1] as AssistantGroup;
		expect(group.lines).toStrictEqual([lines[1], lines[2], lines[3], lines[4]]);
		expect(group.lineIndices).toStrictEqual([1, 2, 3, 4]);
		expect(group.assistantLines).toStrictEqual([lines[1], lines[2], lines[3], lines[4]]);

		expect((result[2] as GroupedLine).line.type).toBe('user');
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
		expect(group.summary).toBe('edited 2 files +2 -2, read a file, ran a bash command');
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

		expect(result.map((r) => r.kind)).toStrictEqual(['line', 'group', 'line', 'group']);
		expect((result[1] as AssistantGroup).lines.length).toBe(2);
		expect((result[3] as AssistantGroup).lines.length).toBe(3);
	});

	it('includes lineIndices for each group', () => {
		const lines = [userLine(0, 'go'), assistantTextLine(1, 'a'), assistantTextLine(2, 'b'), userLine(3, 'next')];
		const result = groupAssistantMessages(lines);
		const group = result[1] as AssistantGroup;
		expect(group.lineIndices).toStrictEqual([1, 2]);
	});

	it('handles assistant-only conversations (no user messages at all)', () => {
		const lines = [assistantTextLine(0, 'first'), assistantTextLine(1, 'second'), assistantTextLine(2, 'third')];
		const result = groupAssistantMessages(lines);
		expect(result.map((r) => r.kind)).toStrictEqual(['group']);
		expect((result[0] as AssistantGroup).lines.length).toBe(3);
	});

	it('includes metadata lines (agent-name) inside the group instead of breaking it', () => {
		const lines = [
			userLine(0, 'do it'),
			assistantTextLine(1, 'working...'),
			agentNameLine(2, 'git-replay-automation'),
			assistantTextLine(3, 'more work'),
			userLine(4, 'done'),
		];
		const result = groupAssistantMessages(lines);
		expect(result.map((r) => r.kind)).toStrictEqual(['line', 'group', 'line']);

		const group = result[1] as AssistantGroup;
		expect(group.lines).toStrictEqual([lines[1], lines[2], lines[3]]);
		expect(group.lineIndices).toStrictEqual([1, 2, 3]);
		expect(group.assistantLines.map((l) => l.lineIndex)).toStrictEqual([1, 3]);
	});

	it('includes attachment lines inside the group instead of breaking it', () => {
		const lines = [
			userLine(0, 'start'),
			assistantTextLine(1, 'working...'),
			attachmentLine(2, {type: 'date_change', newDate: '2026-04-21'}),
			assistantTextLine(3, 'more work'),
			userLine(4, 'done'),
		];
		const result = groupAssistantMessages(lines);
		expect(result.map((r) => r.kind)).toStrictEqual(['line', 'group', 'line']);

		const group = result[1] as AssistantGroup;
		expect(group.lines).toStrictEqual([lines[1], lines[2], lines[3]]);
		expect(group.lineIndices).toStrictEqual([1, 2, 3]);
		expect(group.assistantLines.map((l) => l.lineIndex)).toStrictEqual([1, 3]);
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

	describe('tail text extraction', () => {
		it('extracts tail text from the last assistant line with text content', () => {
			const lines = [
				userLine(0, 'do something'),
				assistantToolLine(1, [{id: 't1', name: 'Read', input: {file_path: '/a.ts'}}]),
				assistantTextLine(2, 'Here is the result'),
				assistantToolLine(3, [{id: 't2', name: 'Bash', input: {command: 'test'}}]),
				userLine(4, 'thanks'),
			];
			const result = groupAssistantMessages(lines);
			const group = result[1] as AssistantGroup;
			expect(group.tailText).toStrictEqual({
				line: lines[2] as MessageSessionLine,
				lineIndex: 2,
				textBlockIndices: [0],
			} satisfies TailText);
		});

		it('extracts tail text from a mixed line (text + tool_use)', () => {
			const lines = [
				userLine(0, 'do something'),
				assistantMixedLine(1, 'checking...', [{id: 't1', name: 'Read', input: {file_path: '/a.ts'}}]),
				assistantMixedLine(2, 'done editing', [
					{id: 't2', name: 'Edit', input: {file_path: '/b.ts', old_string: 'x', new_string: 'y'}},
				]),
				userLine(3, 'ok'),
			];
			const result = groupAssistantMessages(lines);
			const group = result[1] as AssistantGroup;
			expect(group.tailText).toStrictEqual({
				line: lines[2] as MessageSessionLine,
				lineIndex: 2,
				textBlockIndices: [0],
			} satisfies TailText);
		});

		it('returns null tailText when no assistant line has text content', () => {
			const lines = [
				userLine(0, 'do something'),
				assistantToolLine(1, [{id: 't1', name: 'Read', input: {file_path: '/a.ts'}}]),
				assistantToolLine(2, [
					{id: 't2', name: 'Edit', input: {file_path: '/b.ts', old_string: 'x', new_string: 'y'}},
				]),
				userLine(3, 'ok'),
			];
			const result = groupAssistantMessages(lines);
			const group = result[1] as AssistantGroup;
			expect(group.tailText).toStrictEqual(null);
		});

		it('finds tail text with multiple text blocks in one line', () => {
			const multiTextLine: SessionLine = {
				type: 'assistant',
				uuid: 'uuid-2',
				lineIndex: 2,
				message: {
					role: 'assistant',
					content: [
						{type: 'tool_use', id: 't1', name: 'Read', input: {} as SessionContentBlock['input']},
						{type: 'text', text: 'first paragraph'},
						{type: 'text', text: 'second paragraph'},
					],
				},
			};
			const lines = [
				userLine(0, 'do it'),
				assistantToolLine(1, [{id: 't0', name: 'Bash', input: {command: 'ls'}}]),
				multiTextLine,
				userLine(3, 'ok'),
			];
			const result = groupAssistantMessages(lines);
			const group = result[1] as AssistantGroup;
			expect(group.tailText).toStrictEqual({
				line: multiTextLine as MessageSessionLine,
				lineIndex: 2,
				textBlockIndices: [1, 2],
			} satisfies TailText);
		});

		it('skips assistant lines with empty text content', () => {
			const emptyTextLine: SessionLine = {
				type: 'assistant',
				uuid: 'uuid-3',
				lineIndex: 3,
				message: {role: 'assistant', content: [{type: 'text', text: ''}]},
			};
			const lines = [
				userLine(0, 'do it'),
				assistantToolLine(1, [{id: 't1', name: 'Read', input: {file_path: '/a.ts'}}]),
				assistantTextLine(2, 'real text here'),
				emptyTextLine,
				userLine(4, 'ok'),
			];
			const result = groupAssistantMessages(lines);
			const group = result[1] as AssistantGroup;
			expect(group.tailText).toStrictEqual({
				line: lines[2] as MessageSessionLine,
				lineIndex: 2,
				textBlockIndices: [0],
			} satisfies TailText);
		});
	});

	describe('simple Q&A exception', () => {
		it('emits standalone GroupedLine for single text-only assistant line', () => {
			const lines = [userLine(0, 'what is 2+2?'), assistantTextLine(1, '4'), userLine(2, 'thanks')];
			const result = groupAssistantMessages(lines);
			expect(result.map((r) => r.kind)).toStrictEqual(['line', 'line', 'line']);
			expect((result[1] as GroupedLine).line).toBe(lines[1]);
		});

		it('groups a single assistant line that has tool_use blocks', () => {
			const lines = [
				userLine(0, 'read a file'),
				assistantToolLine(1, [{id: 't1', name: 'Read', input: {file_path: '/foo.ts'}}]),
				userLine(2, 'thanks'),
			];
			const result = groupAssistantMessages(lines);
			expect(result.map((r) => r.kind)).toStrictEqual(['line', 'group', 'line']);
		});

		it('groups a single mixed line (text + tool_use)', () => {
			const lines = [
				userLine(0, 'check it'),
				assistantMixedLine(1, 'let me read', [{id: 't1', name: 'Read', input: {file_path: '/foo.ts'}}]),
				userLine(2, 'ok'),
			];
			const result = groupAssistantMessages(lines);
			expect(result.map((r) => r.kind)).toStrictEqual(['line', 'group', 'line']);
		});
	});

	describe('groups with non-assistant lines', () => {
		it('groups permission-mode and pr-link lines inside the group', () => {
			const lines = [
				userLine(0, 'start'),
				permissionModeLine(1, 'auto'),
				assistantTextLine(2, 'working...'),
				prLinkLine(3),
				assistantTextLine(4, 'done'),
				userLine(5, 'bye'),
			];
			const result = groupAssistantMessages(lines);
			expect(result.map((r) => r.kind)).toStrictEqual(['line', 'group', 'line']);

			const group = result[1] as AssistantGroup;
			expect(group.lines.length).toBe(4);
			expect(group.lineIndices).toStrictEqual([1, 2, 3, 4]);
			expect(group.assistantLines.length).toBe(2);
		});

		it('groups attachment-only spans (no assistant lines) into an AssistantGroup', () => {
			const lines = [
				userLine(0, 'start'),
				attachmentLine(1, {type: 'date_change', newDate: '2026-04-21'}),
				attachmentLine(2, {type: 'file', path: '/foo.ts'}),
				userLine(3, 'end'),
			];
			const result = groupAssistantMessages(lines);
			expect(result.map((r) => r.kind)).toStrictEqual(['line', 'group', 'line']);

			const group = result[1] as AssistantGroup;
			expect(group.lines.length).toBe(2);
			expect(group.assistantLines).toStrictEqual([]);
			expect(group.tailText).toStrictEqual(null);
			expect(group.toolCallCount).toBe(0);
		});

		it('emits single non-assistant non-user line as GroupedLine', () => {
			const lines = [userLine(0, 'start'), agentNameLine(1, 'my-agent'), userLine(2, 'end')];
			const result = groupAssistantMessages(lines);
			expect(result.map((r) => r.kind)).toStrictEqual(['line', 'line', 'line']);
		});
	});

	describe('startIndex backward compatibility', () => {
		it('provides startIndex equal to first lineIndex', () => {
			const lines = [
				userLine(0, 'go'),
				assistantTextLine(1, 'a'),
				assistantTextLine(2, 'b'),
				userLine(3, 'next'),
			];
			const result = groupAssistantMessages(lines);
			const group = result[1] as AssistantGroup;
			expect(group.startIndex).toBe(1);
			expect(group.startIndex).toBe(group.lineIndices[0]);
		});
	});
});
