import {writeFileSync, appendFileSync, mkdirSync, rmSync, utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
	extractSessionTitle,
	summarizeToolCalls,
	listSessions,
	readSession,
	readSessionRawWindow,
	readNewJsonlLines,
	parseCommandBlock,
} from '../src/lib/sessions';

const testDir = join(tmpdir(), 'claude-sessions-test-' + process.pid);

beforeEach(() => {
	mkdirSync(testDir, {recursive: true});
});

afterEach(() => {
	rmSync(testDir, {recursive: true, force: true});
});

function jsonl(...lines: Record<string, unknown>[]): string {
	return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function userMessage(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {type: 'user', message: {role: 'user', content: text}, ...extra};
}

function userMessageArray(blocks: Record<string, unknown>[]): Record<string, unknown> {
	return {type: 'user', message: {role: 'user', content: blocks}};
}

function assistantMessage(
	blocks: Record<string, unknown>[],
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {type: 'assistant', message: {role: 'assistant', content: blocks}, ...extra};
}

describe('extractSessionTitle', () => {
	it('returns plain text as-is when short', () => {
		expect(extractSessionTitle('Fix the bug')).toBe('Fix the bug');
	});

	it('strips XML command tags', () => {
		expect(extractSessionTitle('<command-message><command-name>/commit</command-name></command-message>')).toBe(
			'/commit',
		);
	});

	it('removes command-name content to avoid slash command duplication', () => {
		expect(
			extractSessionTitle('<command-message>/init</command-message><command-name>slash:init</command-name>'),
		).toBe('/init');
	});

	it('removes command-args content', () => {
		expect(
			extractSessionTitle(
				'<command-message>/plan</command-message><command-name>slash:plan</command-name><command-args>my plan</command-args>',
			),
		).toBe('/plan');
	});

	it('strips local-command-caveat tags', () => {
		expect(extractSessionTitle('<local-command-caveat>note</local-command-caveat> do stuff')).toBe('note do stuff');
	});

	it('returns fallback when empty', () => {
		expect(extractSessionTitle('', 'abc-123')).toBe('abc-123');
	});

	it('returns default fallback when no fallback provided', () => {
		expect(extractSessionTitle('')).toBe('Untitled Session');
	});

	it('truncates at word boundary with ellipsis', () => {
		const long =
			'This is a very long title that exceeds the eighty character limit and should be truncated at a word boundary';
		const result = extractSessionTitle(long);
		expect(result.length).toBeLessThanOrEqual(83); // 80 + '...'
		expect(result.endsWith('...')).toBe(true);
		expect(result).not.toContain('boundary');
	});
});

describe('parseCommandBlock', () => {
	it('returns null for plain text', () => {
		expect(parseCommandBlock('Hello world')).toBe(null);
	});

	it('extracts command name', () => {
		const text = '<command-message>git:commit</command-message>\n<command-name>/git:commit</command-name>';
		expect(parseCommandBlock(text)).toStrictEqual({name: '/git:commit'});
	});

	it('extracts command name and args', () => {
		const text =
			'<command-message>git:commit</command-message>\n<command-name>/git:commit</command-name>\n<command-args>--amend</command-args>';
		expect(parseCommandBlock(text)).toStrictEqual({name: '/git:commit', args: '--amend'});
	});

	it('trims whitespace from args', () => {
		const text = '<command-name>/test</command-name>\n<command-args>  some args  </command-args>';
		expect(parseCommandBlock(text)).toStrictEqual({name: '/test', args: 'some args'});
	});

	it('returns undefined args when args tag is empty', () => {
		const text = '<command-name>/test</command-name>\n<command-args></command-args>';
		expect(parseCommandBlock(text)).toStrictEqual({name: '/test'});
	});
});

describe('summarizeToolCalls', () => {
	it('returns empty string for no calls', () => {
		expect(summarizeToolCalls([])).toBe('');
	});

	it('single Read', () => {
		expect(summarizeToolCalls([{id: 'tc1', name: 'Read', input: {file_path: '/foo'}, sourceUuid: ''}])).toBe(
			'read a file',
		);
	});

	it('multiple Reads', () => {
		expect(
			summarizeToolCalls([
				{id: 'tc1', name: 'Read', input: {file_path: '/a'}, sourceUuid: ''},
				{id: 'tc2', name: 'Read', input: {file_path: '/b'}, sourceUuid: ''},
			]),
		).toBe('read 2 files');
	});

	it('mixed tools', () => {
		const calls = [
			{id: 'tc1', name: 'Edit', input: {}, sourceUuid: ''},
			{id: 'tc2', name: 'Edit', input: {}, sourceUuid: ''},
			{id: 'tc3', name: 'Edit', input: {}, sourceUuid: ''},
			{id: 'tc4', name: 'Read', input: {}, sourceUuid: ''},
			{id: 'tc5', name: 'Bash', input: {}, sourceUuid: ''},
			{id: 'tc6', name: 'Bash', input: {}, sourceUuid: ''},
		];
		expect(summarizeToolCalls(calls)).toBe('edited 3 files, read a file, ran 2 bash commands');
	});

	it('groups Edit and Write together', () => {
		const calls = [
			{id: 'tc1', name: 'Edit', input: {}, sourceUuid: ''},
			{id: 'tc2', name: 'Write', input: {file_path: '/some/code.ts', content: 'one\ntwo'}, sourceUuid: ''},
		];
		expect(summarizeToolCalls(calls)).toBe('edited 2 files +2');
	});

	it('single Grep', () => {
		expect(summarizeToolCalls([{id: 'tc1', name: 'Grep', input: {}, sourceUuid: ''}])).toBe(
			'searched for a pattern',
		);
	});

	it('multiple Greps', () => {
		const calls = [
			{id: 'tc1', name: 'Grep', input: {}, sourceUuid: ''},
			{id: 'tc2', name: 'Grep', input: {}, sourceUuid: ''},
		];
		expect(summarizeToolCalls(calls)).toBe('searched for 2 patterns');
	});

	it('agents', () => {
		const calls = [
			{id: 'tc1', name: 'Agent', input: {}, sourceUuid: ''},
			{id: 'tc2', name: 'Agent', input: {}, sourceUuid: ''},
			{id: 'tc3', name: 'Agent', input: {}, sourceUuid: ''},
		];
		expect(summarizeToolCalls(calls)).toBe('ran 3 agents');
	});

	it('groups unknown tools as called N tools', () => {
		const calls = [
			{id: 'tc1', name: 'CustomTool', input: {}, sourceUuid: ''},
			{id: 'tc2', name: 'AnotherTool', input: {}, sourceUuid: ''},
		];
		expect(summarizeToolCalls(calls)).toBe('called 2 tools');
	});

	it('single unknown tool', () => {
		expect(summarizeToolCalls([{id: 'tc1', name: 'CustomTool', input: {}, sourceUuid: ''}])).toBe('called a tool');
	});

	it('Edit calls include +N -N diff stats summed across calls', () => {
		const calls = [
			{
				id: 'tc1',
				name: 'Edit',
				input: {file_path: '/a.ts', old_string: 'one\ntwo\nthree', new_string: 'ONE\nTWO\nthree\nfour'},
				sourceUuid: '',
			},
			{
				id: 'tc2',
				name: 'Edit',
				input: {file_path: '/b.ts', old_string: 'x', new_string: 'y\nz'},
				sourceUuid: '',
			},
		];
		// Edit 1: removed 2, added 3 (one,two -> ONE,TWO,four). Edit 2: removed 1, added 2.
		expect(summarizeToolCalls(calls)).toBe('edited 2 files +5 -3');
	});

	it('Write of a memory file is reported as wrote a memory', () => {
		const calls = [
			{
				id: 'tc1',
				name: 'Write',
				input: {
					file_path: '/Users/craig/.claude/projects/-Users-craig-projects-foo/memory/MEMORY.md',
					content: 'hello\n',
				},
				sourceUuid: '',
			},
		];
		expect(summarizeToolCalls(calls)).toBe('wrote a memory');
	});

	it('Read of a memory file is reported as recalled a memory', () => {
		const calls = [
			{
				id: 'tc1',
				name: 'Read',
				input: {file_path: '/Users/craig/.claude/memory/MEMORY.md'},
				sourceUuid: '',
			},
		];
		expect(summarizeToolCalls(calls)).toBe('recalled a memory');
	});

	it('rich mixed summary matching Claude Code format', () => {
		const calls = [
			// 9 edits with diff stats
			...Array.from({length: 9}, (_, i) => ({
				id: `e${i}`,
				name: 'Edit',
				input: {file_path: `/f${i}.ts`, old_string: 'a\nb\nc', new_string: 'A\nB\nC\nD\nE'},
				sourceUuid: '',
			})),
			// 6 grep
			...Array.from({length: 6}, (_, i) => ({id: `g${i}`, name: 'Grep', input: {}, sourceUuid: ''})),
			// 8 reads (non-memory)
			...Array.from({length: 8}, (_, i) => ({
				id: `r${i}`,
				name: 'Read',
				input: {file_path: `/some/file${i}.ts`},
				sourceUuid: '',
			})),
			// 1 unknown tool
			{id: 'u1', name: 'CustomTool', input: {}, sourceUuid: ''},
			// 4 bash
			...Array.from({length: 4}, (_, i) => ({id: `b${i}`, name: 'Bash', input: {}, sourceUuid: ''})),
			// 1 memory read
			{id: 'mr1', name: 'Read', input: {file_path: '/Users/craig/.claude/memory/MEMORY.md'}, sourceUuid: ''},
			// 4 memory writes
			...Array.from({length: 4}, (_, i) => ({
				id: `mw${i}`,
				name: 'Write',
				input: {
					file_path: `/Users/craig/.claude/projects/-foo/memory/m${i}.md`,
					content: 'hi\n',
				},
				sourceUuid: '',
			})),
		];
		// Edits: 9 files; per edit removed 3 added 5 -> totals +45 -27.
		expect(summarizeToolCalls(calls)).toBe(
			'edited 9 files +45 -27, searched for 6 patterns, read 8 files, called a tool, ran 4 bash commands, recalled a memory, wrote 4 memories',
		);
	});
});

describe('listSessions', () => {
	it('returns empty array for empty dir', async () => {
		expect(await listSessions(testDir)).toStrictEqual([]);
	});

	it('returns empty array for non-existent dir', async () => {
		expect(await listSessions(join(testDir, 'nonexistent'))).toStrictEqual([]);
	});

	it('lists sessions grouped by project', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});
		writeFileSync(join(projectDir, 'abc-123.jsonl'), jsonl(userMessage('Fix the login bug')));

		const groups = await listSessions(testDir);
		if (groups.length !== 1) throw new Error(`Expected 1 group, got ${groups.length}`);
		expect(groups[0]!.project).toBe('-Users-craig-projects-app');
		expect(groups[0]!.projectName).toBe('/Users/craig/projects/app');
		expect(groups[0]!.sessions.map((s) => s.title)).toStrictEqual(['Fix the login bug']);
	});

	it('sorts by mtime desc', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});

		writeFileSync(join(projDir, 'older.jsonl'), jsonl(userMessage('Older')));
		writeFileSync(join(projDir, 'newer.jsonl'), jsonl(userMessage('Newer')));

		const pastTime = new Date(Date.now() - 60000);
		utimesSync(join(projDir, 'older.jsonl'), pastTime, pastTime);

		const groups = await listSessions(testDir);
		expect(groups[0]!.sessions[0]!.id).toBe('newer');
		expect(groups[0]!.sessions[1]!.id).toBe('older');
	});

	it('ignores non-jsonl files', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(join(projDir, 'abc.jsonl'), jsonl(userMessage('Hello')));
		writeFileSync(join(projDir, 'readme.md'), '# readme');

		const groups = await listSessions(testDir);
		expect(groups[0]!.sessions.map((s) => s.id)).toStrictEqual(['abc']);
	});

	it('extracts title from first user message', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'sess.jsonl'),
			jsonl(
				{type: 'file-history-snapshot', snapshot: {}},
				{type: 'progress', subtype: 'api_req_started'},
				userMessage('Implement the login page'),
			),
		);

		const groups = await listSessions(testDir);
		expect(groups[0]!.sessions[0]!.title).toBe('Implement the login page');
	});

	it('falls back to session ID when no user message', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(join(projDir, 'my-session.jsonl'), jsonl({type: 'file-history-snapshot', snapshot: {}}));

		const groups = await listSessions(testDir);
		expect(groups[0]!.sessions[0]!.title).toBe('my-session');
	});
});

describe('readSession', () => {
	it('returns messages with text and tool calls', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'test-session.jsonl'),
			jsonl(
				userMessage('Hello'),
				assistantMessage([
					{type: 'text', text: 'Hi there!'},
					{type: 'tool_use', id: 'tool1', name: 'Read', input: {file_path: '/src/index.ts'}},
				]),
			),
		);

		const detail = await readSession(testDir, 'test-session');
		if (!detail) throw new Error('Expected non-null detail');
		expect(detail.title).toBe('Hello');
		expect(detail.projectName).toBe('/Users/craig/projects/app');
		expect(detail.projectId).toBe('-Users-craig-projects-app');
		expect(detail.messages.map((m) => m.role)).toStrictEqual(['user', 'assistant']);

		expect(detail.messages[0]!.textBlocks).toStrictEqual(['Hello']);

		expect(detail.messages[1]!.textBlocks).toStrictEqual(['Hi there!']);
		expect(detail.messages[1]!.toolCalls).toStrictEqual([
			{id: 'tool1', name: 'Read', input: {file_path: '/src/index.ts'}, sourceUuid: ''},
		]);
	});

	it('returns null for non-existent session', async () => {
		expect(await readSession(testDir, 'nonexistent')).toBe(null);
	});

	it('returns null for path traversal', async () => {
		expect(await readSession(testDir, '../etc/passwd')).toBe(null);
	});

	it('returns null for invalid ID characters', async () => {
		expect(await readSession(testDir, 'foo/bar')).toBe(null);
		expect(await readSession(testDir, 'foo bar')).toBe(null);
	});

	it('skips progress and file-history-snapshot entries', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'test-sess.jsonl'),
			jsonl(
				{type: 'file-history-snapshot', snapshot: {}},
				{type: 'progress', subtype: 'api_req_started'},
				userMessage('Hello'),
				{type: 'progress', subtype: 'bash_progress'},
				assistantMessage([{type: 'text', text: 'World'}]),
			),
		);

		const detail = await readSession(testDir, 'test-sess');
		expect(detail!.messages.map((m) => m.role)).toStrictEqual(['user', 'assistant']);
	});

	it('handles user content as array with text blocks', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'arr-user.jsonl'),
			jsonl(
				userMessageArray([
					{type: 'text', text: 'Check this'},
					{type: 'tool_result', tool_use_id: 'tool1', content: 'result'},
				]),
			),
		);

		const detail = await readSession(testDir, 'arr-user');
		expect(detail!.messages[0]!.textBlocks).toStrictEqual(['Check this']);
	});

	it('extracts image blocks from user content arrays', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		const base64Data =
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
		writeFileSync(
			join(projDir, 'image-user.jsonl'),
			jsonl(
				userMessageArray([
					{type: 'text', text: 'Here is a screenshot'},
					{
						type: 'image',
						source: {
							type: 'base64',
							media_type: 'image/png',
							data: base64Data,
						},
					},
				]),
			),
		);

		const detail = await readSession(testDir, 'image-user');
		expect(detail!.messages[0]!.textBlocks).toStrictEqual(['Here is a screenshot']);
		expect(detail!.messages[0]!.content).toContainEqual({
			type: 'image',
			mediaType: 'image/png',
			data: base64Data,
			sourceUuid: expect.any(String),
		});
	});

	it('extracts document blocks from user content arrays', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		const pdfData =
			'JVBERi0xLjQKJeLjz9MNCiXi48zTDQoxIDAgb2JqDTw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+DWVuZG9iDTIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+Pg1lbmRvYg0zIDAgb2JqDTw8L1R5cGUvUGFnZS9QYXJlbnQgMiAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDQgMCBSPj4+Pi9NZWRpYUJveFswIDAgNjEyIDc5Ml0vQ29udGVudHMgNSAwIFI+Pg1lbmRvYg0';
		writeFileSync(
			join(projDir, 'doc-user.jsonl'),
			jsonl(
				userMessageArray([
					{type: 'text', text: 'Please review this PDF'},
					{
						type: 'document',
						source: {
							type: 'base64',
							media_type: 'application/pdf',
							data: pdfData,
						},
					},
				]),
			),
		);

		const detail = await readSession(testDir, 'doc-user');
		expect(detail!.messages[0]!.textBlocks).toStrictEqual(['Please review this PDF']);
		expect(detail!.messages[0]!.content).toContainEqual({
			type: 'document',
			mediaType: 'application/pdf',
			data: pdfData,
			sourceUuid: expect.any(String),
		});
	});

	it('skips thinking blocks from assistant', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'thinking.jsonl'),
			jsonl(
				userMessage('Hi'),
				assistantMessage([
					{type: 'thinking', thinking: 'Let me think...'},
					{type: 'text', text: 'Here is my answer'},
				]),
			),
		);

		const detail = await readSession(testDir, 'thinking');
		expect(detail!.messages[1]!.textBlocks).toStrictEqual(['Here is my answer']);
	});

	it('coalesces consecutive same-role messages', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'coalesce.jsonl'),
			jsonl(userMessage('Part 1'), userMessage('Part 2'), assistantMessage([{type: 'text', text: 'Response'}])),
		);

		const detail = await readSession(testDir, 'coalesce');
		expect(detail!.messages.map((m) => m.role)).toStrictEqual(['user', 'assistant']);
		expect(detail!.messages[0]!.textBlocks).toStrictEqual(['Part 1', 'Part 2']);
	});

	it('extracts tool_result and attaches to correct ToolCallInfo by id', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'tool-result.jsonl'),
			jsonl(
				userMessage('Read a file'),
				assistantMessage([
					{type: 'tool_use', id: 'tu_1', name: 'Read', input: {file_path: '/src/index.ts'}},
					{type: 'tool_use', id: 'tu_2', name: 'Bash', input: {command: 'ls'}},
				]),
				userMessageArray([
					{type: 'tool_result', tool_use_id: 'tu_1', content: '     1\tconst x = 1;'},
					{type: 'tool_result', tool_use_id: 'tu_2', content: 'file1.ts\nfile2.ts'},
				]),
			),
		);

		const detail = await readSession(testDir, 'tool-result');
		if (!detail) throw new Error('Expected non-null detail');
		const assistantMsg = detail.messages[1]!;
		expect(assistantMsg.toolCalls.map((tc) => ({id: tc.id, result: tc.result}))).toStrictEqual([
			{id: 'tu_1', result: '     1\tconst x = 1;'},
			{id: 'tu_2', result: 'file1.ts\nfile2.ts'},
		]);
	});

	it('handles array-format tool_result content', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'arr-result.jsonl'),
			jsonl(
				userMessage('Do something'),
				assistantMessage([{type: 'tool_use', id: 'tu_a', name: 'Read', input: {file_path: '/foo'}}]),
				userMessageArray([
					{
						type: 'tool_result',
						tool_use_id: 'tu_a',
						content: [
							{type: 'text', text: 'line 1'},
							{type: 'text', text: 'line 2'},
						],
					},
				]),
			),
		);

		const detail = await readSession(testDir, 'arr-result');
		const tc = detail!.messages[1]!.toolCalls[0]!;
		expect(tc.result).toBe('line 1\nline 2');
	});

	it('captures is_error from tool_result', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'error-result.jsonl'),
			jsonl(
				userMessage('Try something'),
				assistantMessage([{type: 'tool_use', id: 'tu_err', name: 'Bash', input: {command: 'bad-cmd'}}]),
				userMessageArray([
					{type: 'tool_result', tool_use_id: 'tu_err', content: 'command not found', is_error: true},
				]),
			),
		);

		const detail = await readSession(testDir, 'error-result');
		const tc = detail!.messages[1]!.toolCalls[0]!;
		expect(tc.isError).toBe(true);
		expect(tc.result).toBe('command not found');
	});

	it('truncates results over 150 lines', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		const longResult = Array.from({length: 200}, (_, i) => `line ${i + 1}`).join('\n');
		writeFileSync(
			join(projDir, 'long-result.jsonl'),
			jsonl(
				userMessage('Read big file'),
				assistantMessage([{type: 'tool_use', id: 'tu_long', name: 'Read', input: {file_path: '/big'}}]),
				userMessageArray([{type: 'tool_result', tool_use_id: 'tu_long', content: longResult}]),
			),
		);

		const detail = await readSession(testDir, 'long-result');
		const tc = detail!.messages[1]!.toolCalls[0]!;
		const lines = tc.result!.split('\n');
		expect(lines.length).toBe(151); // 150 lines + truncation indicator
		expect(lines[150]).toBe('... (50 more lines)');
	});

	it('handles empty string tool_result content', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'empty-result.jsonl'),
			jsonl(
				userMessage('Go'),
				assistantMessage([{type: 'tool_use', id: 'tu_e', name: 'Write', input: {file_path: '/f.ts'}}]),
				userMessageArray([{type: 'tool_result', tool_use_id: 'tu_e', content: '', is_error: false}]),
			),
		);

		const detail = await readSession(testDir, 'empty-result');
		const tc = detail!.messages[1]!.toolCalls[0]!;
		expect(tc.result).toBe('');
		expect(tc.isError).toBe(undefined);
	});

	it('strips <tool_use_error> tags from error results', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'tool-error-tags.jsonl'),
			jsonl(
				userMessage('Edit'),
				assistantMessage([{type: 'tool_use', id: 'tu_te', name: 'Edit', input: {file_path: '/f.ts'}}]),
				userMessageArray([
					{
						type: 'tool_result',
						tool_use_id: 'tu_te',
						content: '<tool_use_error>Found 2 matches of the string</tool_use_error>',
						is_error: true,
					},
				]),
			),
		);

		const detail = await readSession(testDir, 'tool-error-tags');
		const tc = detail!.messages[1]!.toolCalls[0]!;
		expect(tc.result).toBe('Found 2 matches of the string');
		expect(tc.isError).toBe(true);
	});

	it('handles orphan tool_use without matching tool_result', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'orphan.jsonl'),
			jsonl(
				userMessage('Go'),
				assistantMessage([{type: 'tool_use', id: 'tu_orphan', name: 'Read', input: {file_path: '/f'}}]),
			),
		);

		const detail = await readSession(testDir, 'orphan');
		const tc = detail!.messages[1]!.toolCalls[0]!;
		expect(tc.result).toBe(undefined);
		expect(tc.isError).toBe(undefined);
	});

	it('renders slash commands as command pills and hides expanded prompt', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'cmd-session.jsonl'),
			jsonl(
				userMessage(
					'<command-message>git:commit</command-message>\n<command-name>/git:commit</command-name>\n<command-args>fix bug</command-args>',
				),
				userMessage('ALWAYS use the `code:cli` skill.\n\n## Context\nThis is the expanded prompt...'),
				assistantMessage([{type: 'text', text: 'Done!'}]),
			),
		);

		const detail = await readSession(testDir, 'cmd-session');
		if (!detail) throw new Error('Expected non-null detail');
		expect(detail.messages.map((m) => m.role)).toStrictEqual(['user', 'assistant']);
		const cmdMsg = detail.messages[0]!;
		expect(cmdMsg.role).toBe('user');
		expect(cmdMsg.isCommand).toBe(true);
		expect(cmdMsg.textBlocks).toStrictEqual(['/git:commit fix bug']);
	});

	it('renders slash commands without args', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'cmd-noargs.jsonl'),
			jsonl(
				userMessage('<command-message>git:commit</command-message>\n<command-name>/git:commit</command-name>'),
				userMessage('Expanded prompt text here'),
				assistantMessage([{type: 'text', text: 'Ok'}]),
			),
		);

		const detail = await readSession(testDir, 'cmd-noargs');
		const cmdMsg = detail!.messages[0]!;
		expect(cmdMsg.isCommand).toBe(true);
		expect(cmdMsg.textBlocks).toStrictEqual(['/git:commit']);
	});

	it('filters out local-command-caveat blocks', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'caveat.jsonl'),
			jsonl(
				userMessageArray([
					{type: 'text', text: '<command-name>/git:commit</command-name>'},
					{type: 'text', text: '<local-command-caveat>This command runs locally</local-command-caveat>'},
				]),
				assistantMessage([{type: 'text', text: 'Ok'}]),
			),
		);

		const detail = await readSession(testDir, 'caveat');
		const cmdMsg = detail!.messages[0]!;
		expect(cmdMsg.isCommand).toBe(true);
		expect(cmdMsg.textBlocks).toStrictEqual(['/git:commit']);
	});

	it('still processes tool_results when coalescing onto command messages', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'cmd-tools.jsonl'),
			jsonl(
				userMessage('<command-name>/git:commit</command-name>'),
				assistantMessage([
					{type: 'text', text: 'Working...'},
					{type: 'tool_use', id: 'tu_cmd', name: 'Bash', input: {command: 'git commit'}},
				]),
				userMessageArray([
					{type: 'tool_result', tool_use_id: 'tu_cmd', content: 'committed'},
					{type: 'text', text: 'Expanded prompt follow-up'},
				]),
			),
		);

		const detail = await readSession(testDir, 'cmd-tools');
		const assistantMsg = detail!.messages[1]!;
		expect(assistantMsg.toolCalls[0]!.result).toBe('committed');
	});

	it('parses bash-input as a bash content block with the command', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'bash-input.jsonl'),
			jsonl(userMessage('<bash-input>git status</bash-input>'), assistantMessage([{type: 'text', text: 'Done'}])),
		);

		const detail = await readSession(testDir, 'bash-input');
		expect(detail!.messages.map((m) => m.role)).toStrictEqual(['user', 'assistant']);
		const msg = detail!.messages[0]!;
		expect(msg.content).toStrictEqual([{type: 'bash-input', command: 'git status', sourceUuid: ''}]);
		expect(msg.textBlocks).toStrictEqual([]);
	});

	it('coalesces bash-input with following bash-stdout/bash-stderr', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'bash-pair.jsonl'),
			jsonl(
				userMessage('<bash-input>ls</bash-input>'),
				userMessage('<bash-stdout>foo\nbar</bash-stdout><bash-stderr></bash-stderr>'),
				assistantMessage([{type: 'text', text: 'Done'}]),
			),
		);

		const detail = await readSession(testDir, 'bash-pair');
		expect(detail!.messages.map((m) => m.role)).toStrictEqual(['user', 'assistant']);
		const msg = detail!.messages[0]!;
		expect(msg.content).toStrictEqual([
			{type: 'bash-input', command: 'ls', sourceUuid: ''},
			{type: 'bash-output', stdout: 'foo\nbar', stderr: '', sourceUuid: ''},
		]);
		expect(msg.textBlocks).toStrictEqual([]);
	});

	it('captures stderr content in bash-output', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'bash-stderr.jsonl'),
			jsonl(
				userMessage('<bash-input>cat missing</bash-input>'),
				userMessage('<bash-stdout></bash-stdout><bash-stderr>cat: missing: No such file</bash-stderr>'),
				assistantMessage([{type: 'text', text: 'Done'}]),
			),
		);

		const detail = await readSession(testDir, 'bash-stderr');
		const msg = detail!.messages[0]!;
		expect(msg.content).toContainEqual({
			type: 'bash-output',
			stdout: '',
			stderr: 'cat: missing: No such file',
			sourceUuid: expect.any(String),
		});
	});

	it('regular user messages are not marked as commands', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'regular.jsonl'),
			jsonl(userMessage('Fix the bug'), assistantMessage([{type: 'text', text: 'Ok'}])),
		);

		const detail = await readSession(testDir, 'regular');
		expect(detail!.messages[0]!.isCommand).toBe(undefined);
	});

	it('handles <persisted-output> wrapper in tool results', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		const content =
			'<persisted-output>\nOutput too large (180.3KB). Full output saved to: /tmp/result.txt\n\nPreview (first 2KB):\nsome preview content\n</persisted-output>';
		writeFileSync(
			join(projDir, 'persisted.jsonl'),
			jsonl(
				userMessage('Run'),
				assistantMessage([{type: 'tool_use', id: 'tu_p', name: 'Bash', input: {command: 'cat big.log'}}]),
				userMessageArray([{type: 'tool_result', tool_use_id: 'tu_p', content}]),
			),
		);

		const detail = await readSession(testDir, 'persisted');
		const tc = detail!.messages[1]!.toolCalls[0]!;
		expect(tc.result).toBe(
			'Output too large (180.3KB). Full output saved to: /tmp/result.txt\n\nPreview (first 2KB):\nsome preview content',
		);
	});

	it('tool_result blocks do not leak into user textBlocks', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'no-leak.jsonl'),
			jsonl(
				userMessage('Go'),
				assistantMessage([{type: 'tool_use', id: 'tu_x', name: 'Read', input: {file_path: '/x'}}]),
				userMessageArray([
					{type: 'tool_result', tool_use_id: 'tu_x', content: 'file content here'},
					{type: 'text', text: 'Follow-up question'},
				]),
			),
		);

		const detail = await readSession(testDir, 'no-leak');
		const userMsg = detail!.messages.find((m) => m.role === 'user' && m.textBlocks.includes('Follow-up question'));
		if (!userMsg) throw new Error('Expected user message with follow-up');
		expect(userMsg.textBlocks).toStrictEqual(['Follow-up question']);
	});

	describe('sourceUuid tracking', () => {
		const U1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
		const U2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
		const U3 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

		it('attaches sourceUuid to text content blocks', async () => {
			const projDir = join(testDir, '-Users-craig-projects-app');
			mkdirSync(projDir, {recursive: true});
			writeFileSync(
				join(projDir, 'src-uuid.jsonl'),
				jsonl(userMessage('hello', {uuid: U1}), assistantMessage([{type: 'text', text: 'world'}], {uuid: U2})),
			);
			const detail = await readSession(testDir, 'src-uuid');
			expect(detail!.messages[0]!.content[0]).toStrictEqual({type: 'text', text: 'hello', sourceUuid: U1});
			expect(detail!.messages[1]!.content[0]).toStrictEqual({type: 'text', text: 'world', sourceUuid: U2});
		});

		it('preserves distinct sourceUuids when same-role messages coalesce', async () => {
			const projDir = join(testDir, '-Users-craig-projects-app');
			mkdirSync(projDir, {recursive: true});
			writeFileSync(
				join(projDir, 'coalesce-uuid.jsonl'),
				jsonl(userMessage('part 1', {uuid: U1}), userMessage('part 2', {uuid: U2})),
			);
			const detail = await readSession(testDir, 'coalesce-uuid');
			const blocks = detail!.messages[0]!.content;
			expect(blocks).toStrictEqual([
				{type: 'text', text: 'part 1', sourceUuid: U1},
				{type: 'text', text: 'part 2', sourceUuid: U2},
			]);
		});

		it('attaches different uuids to bash-input and bash-output', async () => {
			const projDir = join(testDir, '-Users-craig-projects-app');
			mkdirSync(projDir, {recursive: true});
			writeFileSync(
				join(projDir, 'bash-uuid.jsonl'),
				jsonl(
					userMessage('<bash-input>ls</bash-input>', {uuid: U1}),
					userMessage('<bash-stdout>x</bash-stdout><bash-stderr></bash-stderr>', {uuid: U2}),
				),
			);
			const detail = await readSession(testDir, 'bash-uuid');
			const blocks = detail!.messages[0]!.content;
			expect(blocks[0]).toStrictEqual({type: 'bash-input', command: 'ls', sourceUuid: U1});
			expect(blocks[1]).toStrictEqual({type: 'bash-output', stdout: 'x', stderr: '', sourceUuid: U2});
		});

		it('attaches sourceUuid + resultUuid to tool calls', async () => {
			const projDir = join(testDir, '-Users-craig-projects-app');
			mkdirSync(projDir, {recursive: true});
			writeFileSync(
				join(projDir, 'tool-uuid.jsonl'),
				jsonl(
					assistantMessage([{type: 'tool_use', id: 'tu_1', name: 'Read', input: {file_path: '/x'}}], {
						uuid: U1,
					}),
					{
						type: 'user',
						uuid: U2,
						message: {role: 'user', content: [{type: 'tool_result', tool_use_id: 'tu_1', content: 'ok'}]},
					},
				),
			);
			const detail = await readSession(testDir, 'tool-uuid');
			const tc = detail!.messages[0]!.toolCalls[0]!;
			expect(tc).toStrictEqual({
				id: 'tu_1',
				name: 'Read',
				input: {file_path: '/x'},
				result: 'ok',
				sourceUuid: U1,
				resultUuid: U2,
			});
		});

		it('returns uuidToLine map mapping uuids to file line numbers', async () => {
			const projDir = join(testDir, '-Users-craig-projects-app');
			mkdirSync(projDir, {recursive: true});
			writeFileSync(
				join(projDir, 'lines-uuid.jsonl'),
				jsonl(
					userMessage('a', {uuid: U1}),
					userMessage('b', {uuid: U2}),
					assistantMessage([{type: 'text', text: 'c'}], {uuid: U3}),
				),
			);
			const detail = await readSession(testDir, 'lines-uuid');
			expect(detail!.uuidToLine.get(U1)).toBe(0);
			expect(detail!.uuidToLine.get(U2)).toBe(1);
			expect(detail!.uuidToLine.get(U3)).toBe(2);
		});
	});

	describe('readSessionRawWindow', () => {
		const U = (n: number) => `${String(n).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`;

		function makeFile(sessionId: string, ...entries: Record<string, unknown>[]) {
			const projDir = join(testDir, '-Users-craig-projects-app');
			mkdirSync(projDir, {recursive: true});
			writeFileSync(join(projDir, `${sessionId}.jsonl`), jsonl(...entries));
		}

		it('returns the focal entry plus before+after context', async () => {
			makeFile(
				'rw-mid',
				userMessage('a', {uuid: U(0)}),
				userMessage('b', {uuid: U(1)}),
				userMessage('c', {uuid: U(2)}),
				userMessage('d', {uuid: U(3)}),
				userMessage('e', {uuid: U(4)}),
			);
			const result = await readSessionRawWindow(testDir, 'rw-mid', U(2), 1);
			if (!result) throw new Error('Expected non-null result');
			expect(result.focal.lineIndex).toBe(2);
			expect(result.before.map((b) => b.lineIndex)).toStrictEqual([1]);
			expect(result.after.map((a) => a.lineIndex)).toStrictEqual([3]);
		});

		it('returns null when uuid not found', async () => {
			makeFile('rw-miss', userMessage('a', {uuid: U(0)}));
			const result = await readSessionRawWindow(testDir, 'rw-miss', U(99), 5);
			expect(result).toBe(null);
		});

		it('handles focal at start of file with empty before window', async () => {
			makeFile('rw-start', userMessage('a', {uuid: U(0)}), userMessage('b', {uuid: U(1)}));
			const result = await readSessionRawWindow(testDir, 'rw-start', U(0), 5);
			expect(result!.focal.lineIndex).toBe(0);
			expect(result!.before.map((b) => b.lineIndex)).toStrictEqual([]);
			expect(result!.after.map((a) => a.lineIndex)).toStrictEqual([1]);
		});

		it('handles focal at end of file with empty after window', async () => {
			makeFile('rw-end', userMessage('a', {uuid: U(0)}), userMessage('b', {uuid: U(1)}));
			const result = await readSessionRawWindow(testDir, 'rw-end', U(1), 5);
			expect(result!.focal.lineIndex).toBe(1);
			expect(result!.before.map((b) => b.lineIndex)).toStrictEqual([0]);
			expect(result!.after.map((a) => a.lineIndex)).toStrictEqual([]);
		});

		it('marks malformed JSON lines as parse errors in context', async () => {
			const projDir = join(testDir, '-Users-craig-projects-app');
			mkdirSync(projDir, {recursive: true});
			const lines = [
				JSON.stringify(userMessage('a', {uuid: U(0)})),
				'{not valid json',
				JSON.stringify(userMessage('c', {uuid: U(2)})),
			].join('\n');
			writeFileSync(join(projDir, 'rw-bad.jsonl'), lines + '\n');
			const result = await readSessionRawWindow(testDir, 'rw-bad', U(2), 2);
			expect(result!.before.some((b) => b.parseError === true)).toBe(true);
		});

		it('returns the focal raw line and uuid', async () => {
			makeFile('rw-parse', userMessage('a', {uuid: U(0)}));
			const result = await readSessionRawWindow(testDir, 'rw-parse', U(0), 0);
			expect(result!.focal.uuid).toBe(U(0));
			expect(JSON.parse(result!.focal.raw)).toStrictEqual({
				type: 'user',
				uuid: U(0),
				message: {role: 'user', content: 'a'},
			});
		});
	});

	it('reads subagent JSONL files from nested directory', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		const sessionDir = join(projDir, 'parent-session-id');
		const subagentsDir = join(sessionDir, 'subagents');
		mkdirSync(subagentsDir, {recursive: true});

		writeFileSync(
			join(subagentsDir, 'agent-abc123.jsonl'),
			jsonl(userMessage('Start subagent work'), assistantMessage([{type: 'text', text: 'Subagent response'}])),
		);

		const detail = await readSession(testDir, 'agent-abc123');
		if (!detail) throw new Error('Expected non-null detail');
		expect(detail.id).toBe('agent-abc123');
		expect(detail.title).toBe('Start subagent work');
		expect(detail.projectId).toBe('-Users-craig-projects-app');
		expect(detail.messages.map((m) => m.role)).toStrictEqual(['user', 'assistant']);
	});
});

describe('readNewJsonlLines', () => {
	it('reads all lines from byte offset 0', async () => {
		const filePath = join(testDir, 'delta.jsonl');
		writeFileSync(filePath, jsonl(userMessage('Hello'), assistantMessage([{type: 'text', text: 'Hi'}])));

		const result = await readNewJsonlLines(filePath, 0);
		expect(result.lines).toHaveLength(2);
		expect(result.lines[0]!['type']).toBe('user');
		expect(result.lines[1]!['type']).toBe('assistant');
		expect(result.nextByteOffset).toBeGreaterThan(0);
	});

	it('reads only new lines from a non-zero byte offset', async () => {
		const filePath = join(testDir, 'incremental.jsonl');
		const firstLine = JSON.stringify(userMessage('Hello')) + '\n';
		writeFileSync(filePath, firstLine);

		const firstResult = await readNewJsonlLines(filePath, 0);
		expect(firstResult.lines).toHaveLength(1);

		appendFileSync(filePath, JSON.stringify(assistantMessage([{type: 'text', text: 'Hi'}])) + '\n');

		const secondResult = await readNewJsonlLines(filePath, firstResult.nextByteOffset);
		expect(secondResult.lines).toHaveLength(1);
		expect(secondResult.lines[0]!['type']).toBe('assistant');
		expect(secondResult.nextByteOffset).toBeGreaterThan(firstResult.nextByteOffset);
	});

	it('skips partial/malformed trailing line without advancing offset', async () => {
		const filePath = join(testDir, 'partial.jsonl');
		const completeLine = JSON.stringify(userMessage('Hello')) + '\n';
		const partialLine = '{"type":"assistant","message":{"role":"asse';
		writeFileSync(filePath, completeLine + partialLine);

		const result = await readNewJsonlLines(filePath, 0);
		expect(result.lines).toHaveLength(1);
		expect(result.lines[0]!['type']).toBe('user');
		// Offset should only advance past the complete line, not the partial one
		expect(result.nextByteOffset).toBe(Buffer.byteLength(completeLine, 'utf-8'));
	});

	it('returns empty array when offset is at end of file', async () => {
		const filePath = join(testDir, 'at-end.jsonl');
		writeFileSync(filePath, jsonl(userMessage('Hello')));

		const firstResult = await readNewJsonlLines(filePath, 0);
		const secondResult = await readNewJsonlLines(filePath, firstResult.nextByteOffset);
		expect(secondResult.lines).toHaveLength(0);
		expect(secondResult.nextByteOffset).toBe(firstResult.nextByteOffset);
	});

	it('handles empty lines in the file', async () => {
		const filePath = join(testDir, 'blanks.jsonl');
		writeFileSync(
			filePath,
			JSON.stringify(userMessage('Hello')) +
				'\n\n' +
				JSON.stringify(assistantMessage([{type: 'text', text: 'Hi'}])) +
				'\n',
		);

		const result = await readNewJsonlLines(filePath, 0);
		expect(result.lines).toHaveLength(2);
	});
});
