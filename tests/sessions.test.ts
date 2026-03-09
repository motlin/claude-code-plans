import {writeFileSync, mkdirSync, rmSync, utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {extractSessionTitle, summarizeToolCalls, listSessions, readSession} from '../src/lib/sessions';

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

function assistantMessage(blocks: Record<string, unknown>[]): Record<string, unknown> {
	return {type: 'assistant', message: {role: 'assistant', content: blocks}};
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

describe('summarizeToolCalls', () => {
	it('returns empty string for no calls', () => {
		expect(summarizeToolCalls([])).toBe('');
	});

	it('single Read', () => {
		expect(summarizeToolCalls([{id: 'tc1', name: 'Read', input: {file_path: '/foo'}}])).toBe('read a file');
	});

	it('multiple Reads', () => {
		expect(
			summarizeToolCalls([
				{id: 'tc1', name: 'Read', input: {file_path: '/a'}},
				{id: 'tc2', name: 'Read', input: {file_path: '/b'}},
			]),
		).toBe('read 2 files');
	});

	it('mixed tools', () => {
		const calls = [
			{id: 'tc1', name: 'Edit', input: {}},
			{id: 'tc2', name: 'Edit', input: {}},
			{id: 'tc3', name: 'Edit', input: {}},
			{id: 'tc4', name: 'Read', input: {}},
			{id: 'tc5', name: 'Bash', input: {}},
			{id: 'tc6', name: 'Bash', input: {}},
		];
		expect(summarizeToolCalls(calls)).toBe('edited 3 files, read a file, ran 2 commands');
	});

	it('groups Edit and Write together', () => {
		const calls = [
			{id: 'tc1', name: 'Edit', input: {}},
			{id: 'tc2', name: 'Write', input: {}},
		];
		expect(summarizeToolCalls(calls)).toBe('edited 2 files');
	});

	it('single Grep', () => {
		expect(summarizeToolCalls([{id: 'tc1', name: 'Grep', input: {}}])).toBe('searched code');
	});

	it('agents', () => {
		const calls = [
			{id: 'tc1', name: 'Agent', input: {}},
			{id: 'tc2', name: 'Agent', input: {}},
			{id: 'tc3', name: 'Agent', input: {}},
		];
		expect(summarizeToolCalls(calls)).toBe('ran 3 agents');
	});

	it('unknown tool', () => {
		expect(summarizeToolCalls([{id: 'tc1', name: 'CustomTool', input: {}}])).toBe('used CustomTool');
	});
});

describe('listSessions', () => {
	it('returns empty array for empty dir', async () => {
		expect(await listSessions(testDir)).toEqual([]);
	});

	it('returns empty array for non-existent dir', async () => {
		expect(await listSessions(join(testDir, 'nonexistent'))).toEqual([]);
	});

	it('lists sessions grouped by project', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});
		writeFileSync(join(projectDir, 'abc-123.jsonl'), jsonl(userMessage('Fix the login bug')));

		const groups = await listSessions(testDir);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.project).toBe('-Users-craig-projects-app');
		expect(groups[0]!.projectName).toBe('app');
		expect(groups[0]!.sessions).toHaveLength(1);
		expect(groups[0]!.sessions[0]!.title).toBe('Fix the login bug');
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
		expect(groups[0]!.sessions).toHaveLength(1);
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
		expect(detail).not.toBeNull();
		expect(detail!.title).toBe('Hello');
		expect(detail!.projectName).toBe('app');
		expect(detail!.messages).toHaveLength(2);

		expect(detail!.messages[0]!.role).toBe('user');
		expect(detail!.messages[0]!.textBlocks).toEqual(['Hello']);

		expect(detail!.messages[1]!.role).toBe('assistant');
		expect(detail!.messages[1]!.textBlocks).toEqual(['Hi there!']);
		expect(detail!.messages[1]!.toolCalls).toEqual([
			{id: 'tool1', name: 'Read', input: {file_path: '/src/index.ts'}},
		]);
	});

	it('returns null for non-existent session', async () => {
		expect(await readSession(testDir, 'nonexistent')).toBeNull();
	});

	it('returns null for path traversal', async () => {
		expect(await readSession(testDir, '../etc/passwd')).toBeNull();
	});

	it('returns null for invalid ID characters', async () => {
		expect(await readSession(testDir, 'foo/bar')).toBeNull();
		expect(await readSession(testDir, 'foo bar')).toBeNull();
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
		expect(detail!.messages).toHaveLength(2);
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
		expect(detail!.messages).toHaveLength(1);
		expect(detail!.messages[0]!.textBlocks).toEqual(['Check this']);
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
		expect(detail!.messages[1]!.textBlocks).toEqual(['Here is my answer']);
	});

	it('coalesces consecutive same-role messages', async () => {
		const projDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projDir, {recursive: true});
		writeFileSync(
			join(projDir, 'coalesce.jsonl'),
			jsonl(userMessage('Part 1'), userMessage('Part 2'), assistantMessage([{type: 'text', text: 'Response'}])),
		);

		const detail = await readSession(testDir, 'coalesce');
		expect(detail!.messages).toHaveLength(2);
		expect(detail!.messages[0]!.textBlocks).toEqual(['Part 1', 'Part 2']);
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
		expect(detail).not.toBeNull();
		const assistantMsg = detail!.messages[1]!;
		expect(assistantMsg.toolCalls).toHaveLength(2);
		expect(assistantMsg.toolCalls[0]!.id).toBe('tu_1');
		expect(assistantMsg.toolCalls[0]!.result).toBe('     1\tconst x = 1;');
		expect(assistantMsg.toolCalls[1]!.id).toBe('tu_2');
		expect(assistantMsg.toolCalls[1]!.result).toBe('file1.ts\nfile2.ts');
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
		expect(tc.isError).toBeUndefined();
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
		expect(tc.result).not.toContain('<tool_use_error>');
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
		expect(tc.result).toBeUndefined();
		expect(tc.isError).toBeUndefined();
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
		expect(tc.result).toContain('Output too large');
		expect(tc.result).not.toContain('<persisted-output>');
		expect(tc.result).not.toContain('</persisted-output>');
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
		// The user message with tool_result + text should only have the text in textBlocks
		const userMsg = detail!.messages.find((m) => m.role === 'user' && m.textBlocks.includes('Follow-up question'));
		expect(userMsg).toBeDefined();
		expect(userMsg!.textBlocks).not.toContain('file content here');
	});
});
