import {
	SessionIndexEntrySchema,
	SessionsIndexSchema,
	CustomTitleRecordSchema,
	FileHistorySnapshotSchema,
	UserRecordSchema,
	AssistantRecordSchema,
	ProgressRecordSchema,
	SystemRecordSchema,
	LastPromptRecordSchema,
	QueueOperationRecordSchema,
	TextBlockSchema,
	ToolUseBlockSchema,
	ThinkingBlockSchema,
	ToolResultBlockSchema,
	JsonlRecordSchema,
	parseJsonlRecord,
} from '../src/lib/schemas';

describe('SessionIndexEntrySchema', () => {
	it('parses a minimal entry', () => {
		const entry = {
			sessionId: 'abc-123',
			fullPath: '/path/to/abc-123.jsonl',
			fileMtime: 1234567890,
		};
		const result = SessionIndexEntrySchema.safeParse(entry);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.sessionId).toBe('abc-123');
		}
	});

	it('parses a full entry with all optional fields', () => {
		const entry = {
			sessionId: 'abc-123',
			fullPath: '/path/to/abc-123.jsonl',
			fileMtime: 1234567890,
			firstPrompt: 'Fix the bug',
			summary: 'Fixed auth issue',
			messageCount: 5,
			created: '2026-01-01T00:00:00.000Z',
			modified: '2026-01-02T00:00:00.000Z',
			gitBranch: 'main',
			projectPath: '/Users/craig/projects/app',
			isSidechain: false,
		};
		const result = SessionIndexEntrySchema.safeParse(entry);
		expect(result.success).toBe(true);
	});

	it('passes through unknown fields', () => {
		const entry = {
			sessionId: 'abc-123',
			fullPath: '/path/to/abc-123.jsonl',
			fileMtime: 1234567890,
			unknownField: 'hello',
		};
		const result = SessionIndexEntrySchema.safeParse(entry);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data['unknownField']).toBe('hello');
		}
	});
});

describe('SessionsIndexSchema', () => {
	it('parses a sessions index with entries', () => {
		const data = {
			version: 1,
			entries: [
				{
					sessionId: 'abc-123',
					fullPath: '/path/abc-123.jsonl',
					fileMtime: 1234567890,
				},
			],
		};
		const result = SessionsIndexSchema.safeParse(data);
		expect(result.success).toBe(true);
	});

	it('passes through originalPath field', () => {
		const data = {
			version: 1,
			entries: [],
			originalPath: '/Users/craig/.claude/projects/proj/sessions-index.json',
		};
		const result = SessionsIndexSchema.safeParse(data);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data['originalPath']).toBe('/Users/craig/.claude/projects/proj/sessions-index.json');
		}
	});
});

describe('CustomTitleRecordSchema', () => {
	it('parses a custom-title record', () => {
		const record = {
			type: 'custom-title',
			customTitle: 'My Session',
			sessionId: 'abc-123',
		};
		const result = CustomTitleRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.customTitle).toBe('My Session');
		}
	});

	it('rejects wrong type literal', () => {
		const record = {
			type: 'user',
			customTitle: 'My Session',
			sessionId: 'abc-123',
		};
		const result = CustomTitleRecordSchema.safeParse(record);
		expect(result.success).toBe(false);
	});
});

describe('FileHistorySnapshotSchema', () => {
	it('parses a file-history-snapshot with tracked file backups', () => {
		const record = {
			type: 'file-history-snapshot',
			messageId: 'msg-123',
			snapshot: {
				messageId: 'msg-123',
				trackedFileBackups: {
					'/Users/craig/.claude/plans/my-plan.md': 'backup-content',
				},
				timestamp: '2026-01-01T00:00:00.000Z',
			},
			isSnapshotUpdate: false,
		};
		const result = FileHistorySnapshotSchema.safeParse(record);
		expect(result.success).toBe(true);
	});
});

describe('content block schemas', () => {
	it('parses a text block', () => {
		const block = {type: 'text', text: 'Hello world'};
		const result = TextBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.text).toBe('Hello world');
		}
	});

	it('parses a tool_use block', () => {
		const block = {
			type: 'tool_use',
			id: 'tu_123',
			name: 'Read',
			input: {file_path: '/src/index.ts'},
		};
		const result = ToolUseBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.name).toBe('Read');
			expect(result.data.id).toBe('tu_123');
		}
	});

	it('parses a tool_use block with caller field', () => {
		const block = {
			type: 'tool_use',
			id: 'tu_123',
			name: 'Read',
			input: {file_path: '/src/index.ts'},
			caller: 'user',
		};
		const result = ToolUseBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it('parses a thinking block', () => {
		const block = {
			type: 'thinking',
			thinking: 'Let me analyze...',
			signature: 'sig-abc',
		};
		const result = ThinkingBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.thinking).toBe('Let me analyze...');
		}
	});

	it('parses a tool_result block with string content', () => {
		const block = {
			type: 'tool_result',
			tool_use_id: 'tu_123',
			content: 'file contents here',
		};
		const result = ToolResultBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it('parses a tool_result block with array content', () => {
		const block = {
			type: 'tool_result',
			tool_use_id: 'tu_123',
			content: [{type: 'text', text: 'line 1'}],
		};
		const result = ToolResultBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it('parses a tool_result with is_error flag', () => {
		const block = {
			type: 'tool_result',
			tool_use_id: 'tu_123',
			content: 'not found',
			is_error: true,
		};
		const result = ToolResultBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.is_error).toBe(true);
		}
	});
});

describe('UserRecordSchema', () => {
	it('parses a user record with string content', () => {
		const record = {
			type: 'user',
			uuid: 'uuid-123',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-123',
			message: {
				role: 'user',
				content: 'Fix the bug',
			},
		};
		const result = UserRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});

	it('parses a user record with array content', () => {
		const record = {
			type: 'user',
			uuid: 'uuid-123',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-123',
			message: {
				role: 'user',
				content: [
					{type: 'text', text: 'Hello'},
					{type: 'tool_result', tool_use_id: 'tu_1', content: 'result'},
				],
			},
		};
		const result = UserRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});

	it('passes through extra fields like cwd, gitBranch, slug', () => {
		const record = {
			type: 'user',
			uuid: 'uuid-123',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-123',
			cwd: '/Users/craig/projects/app',
			gitBranch: 'main',
			slug: 'radiant-beaming-kay',
			version: '2.1.71',
			isSidechain: false,
			userType: 'external',
			parentUuid: 'parent-uuid',
			message: {
				role: 'user',
				content: 'Hello',
			},
		};
		const result = UserRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});
});

describe('AssistantRecordSchema', () => {
	it('parses an assistant record with content blocks', () => {
		const record = {
			type: 'assistant',
			uuid: 'uuid-456',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-123',
			message: {
				role: 'assistant',
				model: 'claude-opus-4-6',
				id: 'msg_123',
				type: 'message',
				content: [
					{type: 'text', text: 'Here is my answer'},
					{type: 'tool_use', id: 'tu_1', name: 'Read', input: {file_path: '/foo'}},
				],
				stop_reason: 'end_turn',
				stop_sequence: null,
				usage: {input_tokens: 100, output_tokens: 50},
			},
		};
		const result = AssistantRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});

	it('passes through extra fields', () => {
		const record = {
			type: 'assistant',
			uuid: 'uuid-456',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-123',
			requestId: 'req_123',
			cwd: '/Users/craig/projects/app',
			gitBranch: 'main',
			slug: 'radiant-beaming-kay',
			isSidechain: false,
			message: {
				role: 'assistant',
				model: 'claude-opus-4-6',
				id: 'msg_123',
				type: 'message',
				content: [{type: 'text', text: 'Hi'}],
				stop_reason: 'end_turn',
			},
		};
		const result = AssistantRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});
});

describe('ProgressRecordSchema', () => {
	it('parses a progress record', () => {
		const record = {
			type: 'progress',
			uuid: 'uuid-789',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-123',
			data: {type: 'hook_progress', hookEvent: 'SessionStart'},
		};
		const result = ProgressRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});
});

describe('SystemRecordSchema', () => {
	it('parses a system record with subtype', () => {
		const record = {
			type: 'system',
			uuid: 'uuid-sys',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-123',
			subtype: 'turn_duration',
			durationMs: 5000,
		};
		const result = SystemRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.subtype).toBe('turn_duration');
		}
	});
});

describe('LastPromptRecordSchema', () => {
	it('parses a last-prompt record', () => {
		const record = {
			type: 'last-prompt',
			lastPrompt: 'Fix the login bug',
			sessionId: 'sess-123',
		};
		const result = LastPromptRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.lastPrompt).toBe('Fix the login bug');
		}
	});
});

describe('QueueOperationRecordSchema', () => {
	it('parses a queue-operation record', () => {
		const record = {
			type: 'queue-operation',
			operation: 'enqueue',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-123',
			content: 'task notification content',
		};
		const result = QueueOperationRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.operation).toBe('enqueue');
		}
	});
});

describe('JsonlRecordSchema', () => {
	it('parses user records', () => {
		const record = {
			type: 'user',
			uuid: 'uuid-123',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-123',
			message: {role: 'user', content: 'Hello'},
		};
		const result = JsonlRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});

	it('parses assistant records', () => {
		const record = {
			type: 'assistant',
			uuid: 'uuid-456',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-123',
			message: {
				role: 'assistant',
				model: 'claude-opus-4-6',
				id: 'msg_123',
				type: 'message',
				content: [{type: 'text', text: 'Hi'}],
				stop_reason: 'end_turn',
			},
		};
		const result = JsonlRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});

	it('parses custom-title records', () => {
		const result = JsonlRecordSchema.safeParse({
			type: 'custom-title',
			customTitle: 'Title',
			sessionId: 'sess-123',
		});
		expect(result.success).toBe(true);
	});

	it('parses progress records', () => {
		const result = JsonlRecordSchema.safeParse({
			type: 'progress',
			uuid: 'uuid-789',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-123',
			data: {type: 'hook_progress'},
		});
		expect(result.success).toBe(true);
	});

	it('parses system records', () => {
		const result = JsonlRecordSchema.safeParse({
			type: 'system',
			uuid: 'uuid-sys',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-123',
			subtype: 'stop_hook_summary',
		});
		expect(result.success).toBe(true);
	});

	it('parses file-history-snapshot records', () => {
		const result = JsonlRecordSchema.safeParse({
			type: 'file-history-snapshot',
			snapshot: {trackedFileBackups: {}},
		});
		expect(result.success).toBe(true);
	});

	it('parses last-prompt records', () => {
		const result = JsonlRecordSchema.safeParse({
			type: 'last-prompt',
			lastPrompt: 'Fix it',
			sessionId: 'sess-123',
		});
		expect(result.success).toBe(true);
	});

	it('parses queue-operation records', () => {
		const result = JsonlRecordSchema.safeParse({
			type: 'queue-operation',
			operation: 'dequeue',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-123',
			content: 'stuff',
		});
		expect(result.success).toBe(true);
	});
});

describe('parseJsonlRecord', () => {
	it('parses valid JSON and returns typed record', () => {
		const line = JSON.stringify({
			type: 'user',
			uuid: 'uuid-1',
			timestamp: '2026-01-01T00:00:00.000Z',
			sessionId: 'sess-1',
			message: {role: 'user', content: 'Hello'},
		});
		const result = parseJsonlRecord(line);
		expect(result).not.toBeNull();
		expect(result!.type).toBe('user');
	});

	it('returns null for malformed JSON', () => {
		expect(parseJsonlRecord('not json')).toBeNull();
	});

	it('returns null for empty line', () => {
		expect(parseJsonlRecord('')).toBeNull();
		expect(parseJsonlRecord('   ')).toBeNull();
	});

	it('returns the raw parsed object for unknown types', () => {
		const line = JSON.stringify({type: 'unknown-future-type', data: 'stuff'});
		const result = parseJsonlRecord(line);
		expect(result).not.toBeNull();
		expect(result!.type).toBe('unknown-future-type');
	});
});
