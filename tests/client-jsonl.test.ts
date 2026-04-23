import {describe, it, expect} from 'vitest';
import {interpretJsonlLines} from '../src/lib/client-jsonl';

describe('interpretJsonlLines', () => {
	it('returns empty results for empty input', () => {
		const result = interpretJsonlLines([], 0);
		expect(result.newSessionLines).toStrictEqual([]);
		expect(result.newToolResults.size).toBe(0);
	});

	it('filters out non-user/assistant lines', () => {
		const lines = [
			{type: 'system', uuid: 'sys-1', timestamp: '1999-12-31T00:00:00Z'},
			{type: 'progress', uuid: 'prog-1'},
			{type: 'custom-title', customTitle: 'My Title'},
		];
		const result = interpretJsonlLines(lines, 0);
		expect(result.newSessionLines).toStrictEqual([]);
	});

	it('includes user lines with correct lineIndex offset', () => {
		const lines = [
			{
				type: 'user',
				uuid: 'u-1',
				timestamp: '1999-12-31T00:00:00Z',
				message: {role: 'user', content: [{type: 'text', text: 'Hello'}]},
			},
		];
		const result = interpretJsonlLines(lines, 5);
		expect(result.newSessionLines).toStrictEqual([
			{
				type: 'user',
				uuid: 'u-1',
				timestamp: '1999-12-31T00:00:00Z',
				lineIndex: 5,
				message: {role: 'user', content: [{type: 'text', text: 'Hello'}]},
			},
		]);
	});

	it('includes assistant lines', () => {
		const lines = [
			{
				type: 'assistant',
				uuid: 'a-1',
				timestamp: '1999-12-31T00:01:00Z',
				message: {role: 'assistant', content: [{type: 'text', text: 'Hi there'}]},
			},
		];
		const result = interpretJsonlLines(lines, 0);
		expect(result.newSessionLines).toStrictEqual([
			{
				type: 'assistant',
				uuid: 'a-1',
				timestamp: '1999-12-31T00:01:00Z',
				lineIndex: 0,
				message: {role: 'assistant', content: [{type: 'text', text: 'Hi there'}]},
			},
		]);
	});

	it('pairs tool_use with tool_result across assistant+user lines', () => {
		const lines = [
			{
				type: 'assistant',
				uuid: 'a-1',
				timestamp: '1999-12-31T00:00:00Z',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							id: 'tool-1',
							name: 'Bash',
							input: {command: 'ls'},
						},
					],
				},
			},
			{
				type: 'user',
				uuid: 'u-1',
				timestamp: '1999-12-31T00:00:05Z',
				message: {
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: 'tool-1',
							content: 'file1.txt\nfile2.txt',
							is_error: false,
						},
					],
				},
			},
		];
		const result = interpretJsonlLines(lines, 0);
		expect(result.newToolResults.size).toBe(1);
		const toolResult = result.newToolResults.get('tool-1');
		if (!toolResult) throw new Error('Expected toolResult for tool-1');
		expect(toolResult).toStrictEqual({
			result: 'file1.txt\nfile2.txt',
			isError: false,
			resultUuid: 'u-1',
			duration: 5000,
		});
	});

	it('computes tool duration from timestamps', () => {
		const startTime = '1999-12-31T00:00:00.000Z';
		const endTime = '1999-12-31T00:00:03.000Z';
		const lines = [
			{
				type: 'assistant',
				uuid: 'a-1',
				timestamp: startTime,
				message: {
					role: 'assistant',
					content: [{type: 'tool_use', id: 'tool-1', name: 'Read', input: {file_path: '/tmp/f'}}],
				},
			},
			{
				type: 'user',
				uuid: 'u-1',
				timestamp: endTime,
				message: {
					role: 'user',
					content: [{type: 'tool_result', tool_use_id: 'tool-1', content: 'data'}],
				},
			},
		];
		const result = interpretJsonlLines(lines, 0);
		expect(result.newToolResults.get('tool-1')!.duration).toBe(3000);
	});

	it('strips system-reminder tags from tool results', () => {
		const lines = [
			{
				type: 'assistant',
				uuid: 'a-1',
				timestamp: '1999-12-31T00:00:00Z',
				message: {
					role: 'assistant',
					content: [{type: 'tool_use', id: 'tool-1', name: 'Bash', input: {command: 'echo hi'}}],
				},
			},
			{
				type: 'user',
				uuid: 'u-1',
				timestamp: '1999-12-31T00:00:01Z',
				message: {
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: 'tool-1',
							content: 'output<system-reminder>hidden stuff</system-reminder>',
						},
					],
				},
			},
		];
		const result = interpretJsonlLines(lines, 0);
		expect(result.newToolResults.get('tool-1')!.result).toBe('output');
	});

	it('marks error tool results', () => {
		const lines = [
			{
				type: 'assistant',
				uuid: 'a-1',
				timestamp: '1999-12-31T00:00:00Z',
				message: {
					role: 'assistant',
					content: [{type: 'tool_use', id: 'tool-1', name: 'Bash', input: {command: 'fail'}}],
				},
			},
			{
				type: 'user',
				uuid: 'u-1',
				timestamp: '1999-12-31T00:00:01Z',
				message: {
					role: 'user',
					content: [{type: 'tool_result', tool_use_id: 'tool-1', content: 'error msg', is_error: true}],
				},
			},
		];
		const result = interpretJsonlLines(lines, 0);
		expect(result.newToolResults.get('tool-1')!.isError).toBe(true);
	});

	it('handles tool_result with array content blocks', () => {
		const lines = [
			{
				type: 'assistant',
				uuid: 'a-1',
				timestamp: '1999-12-31T00:00:00Z',
				message: {
					role: 'assistant',
					content: [{type: 'tool_use', id: 'tool-1', name: 'Read', input: {file_path: '/tmp/f'}}],
				},
			},
			{
				type: 'user',
				uuid: 'u-1',
				timestamp: '1999-12-31T00:00:01Z',
				message: {
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: 'tool-1',
							content: [
								{type: 'text', text: 'line1'},
								{type: 'text', text: 'line2'},
							],
						},
					],
				},
			},
		];
		const result = interpretJsonlLines(lines, 0);
		expect(result.newToolResults.get('tool-1')!.result).toBe('line1\nline2');
	});

	it('preserves parentUuid on session lines', () => {
		const lines = [
			{
				type: 'assistant',
				uuid: 'a-1',
				parentUuid: 'u-0',
				timestamp: '1999-12-31T00:00:00Z',
				message: {role: 'assistant', content: [{type: 'text', text: 'response'}]},
			},
		];
		const result = interpretJsonlLines(lines, 0);
		expect(result.newSessionLines[0]!.parentUuid).toBe('u-0');
	});

	it('increments lineIndex sequentially across all input lines', () => {
		const lines = [
			{type: 'system', uuid: 'sys-1'},
			{
				type: 'user',
				uuid: 'u-1',
				message: {role: 'user', content: 'hello'},
			},
			{type: 'progress', uuid: 'prog-1'},
			{
				type: 'assistant',
				uuid: 'a-1',
				message: {role: 'assistant', content: [{type: 'text', text: 'hi'}]},
			},
		];
		const result = interpretJsonlLines(lines, 10);
		expect(result.newSessionLines.map((line) => line.lineIndex)).toStrictEqual([11, 13]);
	});

	it('truncates long tool results', () => {
		const longContent = Array.from({length: 200}, (_, i) => `line ${i}`).join('\n');
		const lines = [
			{
				type: 'assistant',
				uuid: 'a-1',
				timestamp: '1999-12-31T00:00:00Z',
				message: {
					role: 'assistant',
					content: [{type: 'tool_use', id: 'tool-1', name: 'Bash', input: {command: 'cat big'}}],
				},
			},
			{
				type: 'user',
				uuid: 'u-1',
				timestamp: '1999-12-31T00:00:01Z',
				message: {
					role: 'user',
					content: [{type: 'tool_result', tool_use_id: 'tool-1', content: longContent}],
				},
			},
		];
		const result = interpretJsonlLines(lines, 0);
		const resultText = result.newToolResults.get('tool-1')!.result;
		const resultLines = resultText.split('\n');
		expect(resultLines.length).toBeLessThanOrEqual(151);
		expect(resultLines[resultLines.length - 1]).toMatch(/\d+ more lines/);
	});
});
