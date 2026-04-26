import {describe, it, expect} from 'vitest';
import {
	processTranscript,
	processNewRecords,
	extractToolResultContent,
	stripResultTags,
	truncateResult,
	stripCommandTags,
	extractSessionTitle,
} from '../src/lib/transcript';

// ---------------------------------------------------------------------------
// Helper: build a minimal JSONL record
// ---------------------------------------------------------------------------

function userRecord(content: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {type: 'user', message: {role: 'user', content}, ...extra};
}

function assistantRecord(content: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {type: 'assistant', message: {role: 'assistant', content}, ...extra};
}

// ---------------------------------------------------------------------------
// processTranscript
// ---------------------------------------------------------------------------

describe('processTranscript', () => {
	it('returns empty results for empty input', () => {
		const result = processTranscript([]);
		expect(result.lines).toStrictEqual([]);
		expect(result.toolResultMap.size).toBe(0);
		expect(result.uuidToLine.size).toBe(0);
		expect(result.title).toBe('');
		expect(result.customTitle).toBeUndefined();
	});

	it('includes user and assistant lines with lineIndex', () => {
		const records = [
			userRecord([{type: 'text', text: 'Hello'}], {uuid: 'u-1', timestamp: '1999-12-31T00:00:00Z'}),
			assistantRecord([{type: 'text', text: 'Hi'}], {uuid: 'a-1', timestamp: '1999-12-31T00:01:00Z'}),
		];
		const result = processTranscript(records);
		expect(result.lines).toHaveLength(2);
		expect(result.lines[0]!.type).toBe('user');
		expect(result.lines[0]!.lineIndex).toBe(0);
		expect(result.lines[1]!.type).toBe('assistant');
		expect(result.lines[1]!.lineIndex).toBe(1);
	});

	it('filters out non-rendering record types', () => {
		const records = [
			{type: 'system', uuid: 'sys-1', timestamp: '1999-12-31T00:00:00Z'},
			{type: 'progress', uuid: 'prog-1'},
			{type: 'file-history-snapshot', snapshot: {trackedFileBackups: {}}},
		];
		const result = processTranscript(records);
		expect(result.lines).toStrictEqual([]);
	});

	it('extracts title from first user text', () => {
		const records = [
			userRecord([{type: 'text', text: 'Fix the login page'}], {uuid: 'u-1'}),
			assistantRecord([{type: 'text', text: 'Done'}], {uuid: 'a-1'}),
		];
		const result = processTranscript(records);
		expect(result.title).toBe('Fix the login page');
	});

	it('extracts customTitle from custom-title records', () => {
		const records = [
			{type: 'custom-title', customTitle: 'My Custom Title', sessionId: 's-1'},
			userRecord([{type: 'text', text: 'Hello'}], {uuid: 'u-1'}),
		];
		const result = processTranscript(records);
		expect(result.customTitle).toBe('My Custom Title');
	});

	it('builds uuidToLine mapping', () => {
		const records = [
			userRecord([{type: 'text', text: 'Hello'}], {uuid: 'u-1'}),
			assistantRecord([{type: 'text', text: 'Hi'}], {uuid: 'a-1'}),
		];
		const result = processTranscript(records);
		expect(result.uuidToLine.get('u-1')).toBe(0);
		expect(result.uuidToLine.get('a-1')).toBe(1);
	});

	it('pairs tool_use with tool_result and computes duration', () => {
		const records = [
			assistantRecord([{type: 'tool_use', id: 'tool-1', name: 'Bash', input: {command: 'ls'}}], {
				uuid: 'a-1',
				timestamp: '1999-12-31T00:00:00.000Z',
			}),
			userRecord([{type: 'tool_result', tool_use_id: 'tool-1', content: 'file1.txt\nfile2.txt'}], {
				uuid: 'u-1',
				timestamp: '1999-12-31T00:00:05.000Z',
			}),
		];
		const result = processTranscript(records);
		expect(result.toolResultMap.size).toBe(1);
		const toolResult = result.toolResultMap.get('tool-1');
		expect(toolResult).toStrictEqual({
			result: 'file1.txt\nfile2.txt',
			isError: false,
			resultUuid: 'u-1',
			duration: 5000,
		});
	});

	it('marks error tool results', () => {
		const records = [
			assistantRecord([{type: 'tool_use', id: 'tool-1', name: 'Bash', input: {command: 'fail'}}], {
				uuid: 'a-1',
				timestamp: '1999-12-31T00:00:00Z',
			}),
			userRecord([{type: 'tool_result', tool_use_id: 'tool-1', content: 'error msg', is_error: true}], {
				uuid: 'u-1',
				timestamp: '1999-12-31T00:00:01Z',
			}),
		];
		const result = processTranscript(records);
		expect(result.toolResultMap.get('tool-1')!.isError).toBe(true);
	});

	it('strips system-reminder tags from tool results', () => {
		const records = [
			assistantRecord([{type: 'tool_use', id: 'tool-1', name: 'Bash', input: {command: 'echo hi'}}], {
				uuid: 'a-1',
				timestamp: '1999-12-31T00:00:00Z',
			}),
			userRecord(
				[
					{
						type: 'tool_result',
						tool_use_id: 'tool-1',
						content: 'output<system-reminder>hidden</system-reminder>',
					},
				],
				{uuid: 'u-1', timestamp: '1999-12-31T00:00:01Z'},
			),
		];
		const result = processTranscript(records);
		expect(result.toolResultMap.get('tool-1')!.result).toBe('output');
	});

	it('truncates long tool results', () => {
		const longContent = Array.from({length: 200}, (_, i) => `line ${i}`).join('\n');
		const records = [
			assistantRecord([{type: 'tool_use', id: 'tool-1', name: 'Bash', input: {command: 'cat big'}}], {
				uuid: 'a-1',
				timestamp: '1999-12-31T00:00:00Z',
			}),
			userRecord([{type: 'tool_result', tool_use_id: 'tool-1', content: longContent}], {
				uuid: 'u-1',
				timestamp: '1999-12-31T00:00:01Z',
			}),
		];
		const result = processTranscript(records);
		const resultText = result.toolResultMap.get('tool-1')!.result;
		const resultLines = resultText.split('\n');
		expect(resultLines.length).toBeLessThanOrEqual(151);
		expect(resultLines[resultLines.length - 1]).toMatch(/\d+ more lines/);
	});

	it('handles tool_result with array content blocks', () => {
		const records = [
			assistantRecord([{type: 'tool_use', id: 'tool-1', name: 'Read', input: {file_path: '/tmp/f'}}], {
				uuid: 'a-1',
				timestamp: '1999-12-31T00:00:00Z',
			}),
			userRecord(
				[
					{
						type: 'tool_result',
						tool_use_id: 'tool-1',
						content: [
							{type: 'text', text: 'line1'},
							{type: 'text', text: 'line2'},
						],
					},
				],
				{uuid: 'u-1', timestamp: '1999-12-31T00:00:01Z'},
			),
		];
		const result = processTranscript(records);
		expect(result.toolResultMap.get('tool-1')!.result).toBe('line1\nline2');
	});

	it('includes agent-name lines', () => {
		const records = [{type: 'agent-name', agentName: 'test-agent', sessionId: 's-1'}];
		const result = processTranscript(records);
		expect(result.lines).toHaveLength(1);
		expect(result.lines[0]).toStrictEqual({type: 'agent-name', agentName: 'test-agent', lineIndex: 0});
	});

	it('includes agent-color lines', () => {
		const records = [{type: 'agent-color', agentColor: '#ff0000', sessionId: 's-1'}];
		const result = processTranscript(records);
		expect(result.lines).toHaveLength(1);
		expect(result.lines[0]).toStrictEqual({type: 'agent-color', agentColor: '#ff0000', lineIndex: 0});
	});

	it('includes permission-mode lines', () => {
		const records = [{type: 'permission-mode', permissionMode: 'auto-accept', sessionId: 's-1'}];
		const result = processTranscript(records);
		expect(result.lines).toHaveLength(1);
		expect(result.lines[0]).toStrictEqual({type: 'permission-mode', permissionMode: 'auto-accept', lineIndex: 0});
	});

	it('includes pr-link lines', () => {
		const records = [
			{
				type: 'pr-link',
				prUrl: 'https://github.com/org/repo/pull/42',
				prNumber: 42,
				prRepository: 'org/repo',
				sessionId: 's-1',
				timestamp: '1999-12-31T00:00:00Z',
			},
		];
		const result = processTranscript(records);
		expect(result.lines).toHaveLength(1);
		expect(result.lines[0]).toStrictEqual({
			type: 'pr-link',
			prUrl: 'https://github.com/org/repo/pull/42',
			prNumber: 42,
			prRepository: 'org/repo',
			timestamp: '1999-12-31T00:00:00Z',
			lineIndex: 0,
		});
	});

	it('includes attachment lines', () => {
		const records = [
			{
				type: 'attachment',
				uuid: 'att-1',
				timestamp: '1999-12-31T00:00:00Z',
				attachment: {type: 'plan_mode', planFilePath: '/tmp/plan.md'},
			},
		];
		const result = processTranscript(records);
		expect(result.lines).toHaveLength(1);
		const line = result.lines[0]!;
		expect(line.type).toBe('attachment');
		if (line.type === 'attachment') {
			expect(JSON.parse(line.attachmentJson)).toStrictEqual({type: 'plan_mode', planFilePath: '/tmp/plan.md'});
			expect(line.uuid).toBe('att-1');
			expect(line.timestamp).toBe('1999-12-31T00:00:00Z');
		}
	});

	it('preserves parentUuid on message lines', () => {
		const records = [assistantRecord([{type: 'text', text: 'response'}], {uuid: 'a-1', parentUuid: 'u-0'})];
		const result = processTranscript(records);
		const line = result.lines[0]!;
		if (line.type === 'assistant') {
			expect(line.parentUuid).toBe('u-0');
		}
	});

	it('handles user records with string content', () => {
		const records = [userRecord('simple text', {uuid: 'u-1'})];
		const result = processTranscript(records);
		expect(result.lines).toHaveLength(1);
		expect(result.title).toBe('simple text');
	});

	it('skips malformed records', () => {
		const records = [{type: 'unknown-type-42'}, userRecord([{type: 'text', text: 'Hello'}], {uuid: 'u-1'})];
		const result = processTranscript(records);
		expect(result.lines).toHaveLength(1);
	});

	it('parses subagent records that contain agentId field', () => {
		const records = [
			userRecord([{type: 'text', text: 'subagent prompt'}], {
				uuid: 'u-1',
				agentId: 'agent-abc123',
			}),
			assistantRecord([{type: 'text', text: 'subagent response'}], {
				uuid: 'a-1',
				agentId: 'agent-abc123',
			}),
		];
		const result = processTranscript(records);
		expect(result.lines).toHaveLength(2);
		expect(result.title).toBe('subagent prompt');
	});

	it('parses tool_use blocks with unknown tool names', () => {
		const records = [
			assistantRecord([{type: 'tool_use', id: 'tool-1', name: 'bash', input: {command: 'ls'}}], {
				uuid: 'a-1',
				timestamp: '1999-12-31T00:00:00Z',
			}),
			userRecord([{type: 'tool_result', tool_use_id: 'tool-1', content: 'output'}], {
				uuid: 'u-1',
				timestamp: '1999-12-31T00:00:01Z',
			}),
		];
		const result = processTranscript(records);
		expect(result.lines).toHaveLength(2);
		expect(result.toolResultMap.size).toBe(1);
	});

	it('deduplicates consecutive identical slash command messages', () => {
		const commandContent =
			'<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>';
		const caveatContent =
			'<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>';
		const stdoutContent = '<local-command-stdout>(no content)</local-command-stdout>';
		const records = [
			userRecord(caveatContent),
			userRecord(commandContent, {uuid: 'cmd-1'}),
			userRecord(stdoutContent),
			userRecord(caveatContent),
			userRecord(commandContent, {uuid: 'cmd-2'}),
			userRecord(stdoutContent),
		];
		const result = processTranscript(records);
		// Only one command group should appear: caveat + command + stdout
		const commandLines = result.lines.filter(
			(l) =>
				l.type === 'user' &&
				'message' in l &&
				typeof l.message?.content === 'string' &&
				l.message.content.includes('<command-name>'),
		);
		expect(commandLines).toHaveLength(1);
	});

	it('keeps non-consecutive identical slash commands', () => {
		const commandContent =
			'<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>';
		const records = [
			userRecord(commandContent, {uuid: 'cmd-1'}),
			userRecord([{type: 'text', text: 'regular user message'}], {uuid: 'u-1'}),
			assistantRecord([{type: 'text', text: 'response'}], {uuid: 'a-1'}),
			userRecord(commandContent, {uuid: 'cmd-2'}),
		];
		const result = processTranscript(records);
		const commandLines = result.lines.filter(
			(l) =>
				l.type === 'user' &&
				'message' in l &&
				typeof l.message?.content === 'string' &&
				l.message.content.includes('<command-name>'),
		);
		expect(commandLines).toHaveLength(2);
	});

	it('keeps consecutive different slash commands', () => {
		const chromeCommand =
			'<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>';
		const compactCommand =
			'<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>';
		const records = [userRecord(chromeCommand, {uuid: 'cmd-1'}), userRecord(compactCommand, {uuid: 'cmd-2'})];
		const result = processTranscript(records);
		const commandLines = result.lines.filter(
			(l) =>
				l.type === 'user' &&
				'message' in l &&
				typeof l.message?.content === 'string' &&
				l.message.content.includes('<command-name>'),
		);
		expect(commandLines).toHaveLength(2);
	});

	it('deduplicates command groups separated by a blank assistant message', () => {
		const commandContent =
			'<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>';
		const caveatContent =
			'<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>';
		const stdoutContent = '<local-command-stdout>(no content)</local-command-stdout>';
		const records = [
			userRecord(caveatContent),
			userRecord(commandContent, {uuid: 'cmd-1'}),
			userRecord(stdoutContent),
			assistantRecord([], {uuid: 'a-blank'}),
			userRecord(caveatContent),
			userRecord(commandContent, {uuid: 'cmd-2'}),
			userRecord(stdoutContent),
		];
		const result = processTranscript(records);
		const commandLines = result.lines.filter(
			(l) =>
				l.type === 'user' &&
				'message' in l &&
				typeof l.message?.content === 'string' &&
				l.message.content.includes('<command-name>'),
		);
		expect(commandLines).toHaveLength(1);
		// The blank assistant message should also be removed
		const assistantLines = result.lines.filter((l) => l.type === 'assistant');
		expect(assistantLines).toHaveLength(0);
	});

	it('deduplicates command groups separated by an empty-string assistant message', () => {
		const commandContent =
			'<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>';
		const records = [
			userRecord(commandContent, {uuid: 'cmd-1'}),
			assistantRecord('', {uuid: 'a-blank'}),
			userRecord(commandContent, {uuid: 'cmd-2'}),
		];
		const result = processTranscript(records);
		const commandLines = result.lines.filter(
			(l) =>
				l.type === 'user' &&
				'message' in l &&
				typeof l.message?.content === 'string' &&
				l.message.content.includes('<command-name>'),
		);
		expect(commandLines).toHaveLength(1);
	});

	it('keeps commands separated by a non-blank assistant message', () => {
		const commandContent =
			'<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>';
		const records = [
			userRecord(commandContent, {uuid: 'cmd-1'}),
			assistantRecord([{type: 'text', text: 'Connecting to Chrome...'}], {uuid: 'a-1'}),
			userRecord(commandContent, {uuid: 'cmd-2'}),
		];
		const result = processTranscript(records);
		const commandLines = result.lines.filter(
			(l) =>
				l.type === 'user' &&
				'message' in l &&
				typeof l.message?.content === 'string' &&
				l.message.content.includes('<command-name>'),
		);
		expect(commandLines).toHaveLength(2);
	});

	it('deduplicates command group including caveat and stdout lines', () => {
		const commandContent =
			'<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>';
		const caveatContent =
			'<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>';
		const stdoutContent = '<local-command-stdout>(no content)</local-command-stdout>';
		const records = [
			userRecord(caveatContent),
			userRecord(commandContent, {uuid: 'cmd-1'}),
			userRecord(stdoutContent),
			userRecord(caveatContent),
			userRecord(commandContent, {uuid: 'cmd-2'}),
			userRecord(stdoutContent),
			userRecord([{type: 'text', text: 'is it connected?'}], {uuid: 'u-1'}),
		];
		const result = processTranscript(records);
		// Should have: caveat + command + stdout + "is it connected?" = 4 lines
		// The duplicate caveat + command + stdout group (3 lines) should be removed
		const userLines = result.lines.filter((l) => l.type === 'user');
		expect(userLines).toHaveLength(4);
	});
});

// ---------------------------------------------------------------------------
// processNewRecords
// ---------------------------------------------------------------------------

describe('processNewRecords', () => {
	it('returns empty results for empty input', () => {
		const result = processNewRecords([], 0);
		expect(result.newSessionLines).toStrictEqual([]);
		expect(result.newToolResults.size).toBe(0);
	});

	it('applies startIndex offset to lineIndex', () => {
		const records = [userRecord([{type: 'text', text: 'Hello'}], {uuid: 'u-1'})];
		const result = processNewRecords(records, 5);
		expect(result.newSessionLines[0]!.lineIndex).toBe(5);
	});

	it('pairs tool_use with tool_result in incremental batch', () => {
		const records = [
			assistantRecord([{type: 'tool_use', id: 'tool-1', name: 'Bash', input: {command: 'ls'}}], {
				uuid: 'a-1',
				timestamp: '1999-12-31T00:00:00.000Z',
			}),
			userRecord([{type: 'tool_result', tool_use_id: 'tool-1', content: 'output'}], {
				uuid: 'u-1',
				timestamp: '1999-12-31T00:00:03.000Z',
			}),
		];
		const result = processNewRecords(records, 10);
		expect(result.newToolResults.size).toBe(1);
		expect(result.newToolResults.get('tool-1')!.duration).toBe(3000);
	});

	it('filters non-rendering record types', () => {
		const records = [
			{type: 'system', uuid: 'sys-1'},
			{type: 'progress', uuid: 'prog-1'},
		];
		const result = processNewRecords(records, 0);
		expect(result.newSessionLines).toStrictEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Shared helpers (moved from session-utils.ts)
// ---------------------------------------------------------------------------

describe('extractToolResultContent', () => {
	it('returns string content directly', () => {
		expect(extractToolResultContent('hello')).toBe('hello');
	});

	it('concatenates text blocks from array content', () => {
		const content = [
			{type: 'text', text: 'a'},
			{type: 'text', text: 'b'},
		];
		expect(extractToolResultContent(content)).toBe('a\nb');
	});

	it('returns undefined for non-text array', () => {
		expect(extractToolResultContent([{type: 'image'}])).toBeUndefined();
	});

	it('returns undefined for undefined', () => {
		expect(extractToolResultContent(undefined)).toBeUndefined();
	});
});

describe('stripResultTags', () => {
	it('strips system-reminder tags', () => {
		expect(stripResultTags('output<system-reminder>hidden</system-reminder>')).toBe('output');
	});

	it('strips tool_use_error tags', () => {
		expect(stripResultTags('<tool_use_error>error</tool_use_error>')).toBe('error');
	});

	it('strips persisted-output tags', () => {
		expect(stripResultTags('<persisted-output>data</persisted-output>')).toBe('data');
	});

	it('returns unchanged text when no tags present', () => {
		expect(stripResultTags('no tags here')).toBe('no tags here');
	});
});

describe('truncateResult', () => {
	it('returns short text unchanged', () => {
		expect(truncateResult('short', 10)).toBe('short');
	});

	it('truncates long text with line count', () => {
		const text = Array.from({length: 20}, (_, i) => `line ${i}`).join('\n');
		const result = truncateResult(text, 5);
		const lines = result.split('\n');
		expect(lines).toHaveLength(6);
		expect(lines[5]).toMatch(/15 more lines/);
	});
});

describe('stripCommandTags', () => {
	it('strips command tags from text', () => {
		expect(stripCommandTags('<command-message>hello</command-message>')).toBe('hello');
	});

	it('returns plain text unchanged', () => {
		expect(stripCommandTags('plain text')).toBe('plain text');
	});
});

describe('extractSessionTitle', () => {
	it('returns short text directly', () => {
		expect(extractSessionTitle('Fix the bug')).toBe('Fix the bug');
	});

	it('truncates long text with ellipsis', () => {
		const longText = 'A'.repeat(100);
		const result = extractSessionTitle(longText);
		expect(result.length).toBeLessThan(100);
		expect(result.endsWith('...')).toBe(true);
	});

	it('returns fallback for empty text', () => {
		expect(extractSessionTitle('', 'fallback')).toBe('fallback');
	});

	it('returns Untitled Session for empty text with no fallback', () => {
		expect(extractSessionTitle('')).toBe('Untitled Session');
	});
});
