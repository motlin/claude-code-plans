import {readFileSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import {homedir} from "node:os";
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
	ContentBlockSchema,
	JsonlRecordSchema,
	parseJsonlRecord,
	TaskFileSchema,
	SessionRegistryFileSchema,
	ClaudeSettingsSchema,
} from "../src/lib/schemas";
import {
	BashInputSchema,
	ReadInputSchema,
	EditInputSchema,
	WriteInputSchema,
	GlobInputSchema,
	GrepInputSchema,
	AgentInputSchema,
	ArtifactInputSchema,
	toolInputSchemaByName,
	toolInputSchemas,
} from "../src/lib/tool-input-schemas";
import {baseFields} from "./fixtures/base-fields";
import {jsonlRecordFixtures} from "./fixtures/jsonl-records";
import {diskRegistryIo, scanRegistryDir} from "./registry-disk-scan";

describe("SessionIndexEntrySchema", () => {
	it("parses a minimal entry", () => {
		const entry = {
			sessionId: "abc-123",
			fullPath: "/path/to/abc-123.jsonl",
			fileMtime: 1234567890,
		};
		const result = SessionIndexEntrySchema.safeParse(entry);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.sessionId).toBe("abc-123");
		}
	});

	it("parses a full entry with all optional fields", () => {
		const entry = {
			sessionId: "abc-123",
			fullPath: "/path/to/abc-123.jsonl",
			fileMtime: 1234567890,
			firstPrompt: "Fix the bug",
			summary: "Fixed auth issue",
			messageCount: 5,
			created: "1999-12-31T00:00:00.000Z",
			modified: "2000-01-01T00:00:00.000Z",
			gitBranch: "main",
			projectPath: "/Users/craig/projects/app",
			isSidechain: false,
		};
		const result = SessionIndexEntrySchema.safeParse(entry);
		expect(result.success).toBe(true);
	});

	it("rejects unknown fields", () => {
		const entry = {
			sessionId: "abc-123",
			fullPath: "/path/to/abc-123.jsonl",
			fileMtime: 1234567890,
			unknownField: "hello",
		};
		const result = SessionIndexEntrySchema.safeParse(entry);
		expect(result.success).toBe(false);
	});
});

describe("SessionsIndexSchema", () => {
	it("parses a sessions index with entries", () => {
		const data = {
			version: 1,
			entries: [
				{
					sessionId: "abc-123",
					fullPath: "/path/abc-123.jsonl",
					fileMtime: 1234567890,
				},
			],
		};
		const result = SessionsIndexSchema.safeParse(data);
		expect(result.success).toBe(true);
	});

	it("accepts the originalPath field", () => {
		const data = {
			version: 1,
			entries: [],
			originalPath: "/Users/craig/.claude/projects/proj/sessions-index.json",
		};
		const result = SessionsIndexSchema.safeParse(data);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.originalPath).toBe("/Users/craig/.claude/projects/proj/sessions-index.json");
		}
	});

	it("rejects unknown top-level fields", () => {
		const data = {
			version: 1,
			entries: [],
			bogusField: true,
		};
		const result = SessionsIndexSchema.safeParse(data);
		expect(result.success).toBe(false);
	});
});

describe("CustomTitleRecordSchema", () => {
	it("parses a custom-title record", () => {
		const record = {
			type: "custom-title",
			customTitle: "My Session",
			sessionId: "abc-123",
		};
		const result = CustomTitleRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.customTitle).toBe("My Session");
		}
	});

	it("rejects wrong type literal", () => {
		const record = {
			type: "user",
			customTitle: "My Session",
			sessionId: "abc-123",
		};
		const result = CustomTitleRecordSchema.safeParse(record);
		expect(result.success).toBe(false);
	});
});

describe("FileHistorySnapshotSchema", () => {
	it("parses a file-history-snapshot with tracked file backups", () => {
		const record = {
			type: "file-history-snapshot",
			messageId: "msg-123",
			snapshot: {
				messageId: "msg-123",
				trackedFileBackups: {
					"/Users/craig/.claude/plans/my-plan.md": "backup-content",
				},
				timestamp: "1999-12-31T00:00:00.000Z",
			},
			isSnapshotUpdate: false,
		};
		const result = FileHistorySnapshotSchema.safeParse(record);
		expect(result.success).toBe(true);
	});
});

describe("content block schemas", () => {
	it("parses a text block", () => {
		const block = {type: "text", text: "Hello world"};
		const result = TextBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.text).toBe("Hello world");
		}
	});

	it("parses a tool_use block", () => {
		const block = {
			type: "tool_use",
			id: "tu_123",
			name: "Read",
			input: {file_path: "/src/index.ts"},
		};
		const result = ToolUseBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.name).toBe("Read");
			expect(result.data.id).toBe("tu_123");
		}
	});

	it("parses a tool_use block with caller field", () => {
		const block = {
			type: "tool_use",
			id: "tu_123",
			name: "Read",
			input: {file_path: "/src/index.ts"},
			caller: "user",
		};
		const result = ToolUseBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it("parses a tool_use block with newer Agent effort input", () => {
		const block = {
			type: "tool_use",
			id: "tu_123",
			name: "Agent",
			input: {
				description: "Review the change",
				prompt: "Find risks",
				effort: "high",
			},
		};
		const result = ContentBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it("parses a tool_use block with TaskCreate active form and no subject", () => {
		const block = {
			type: "tool_use",
			id: "tu_123",
			name: "TaskCreate",
			input: {
				description: "Implement the next slice",
				activeForm: "Implementing the next slice",
			},
		};
		const result = ContentBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it("parses a tool_use block with a SendMessage shutdown response", () => {
		const block = {
			type: "tool_use",
			id: "tu_123",
			name: "SendMessage",
			input: {
				to: "team-lead",
				message: {type: "shutdown_response", request_id: "shutdown-177@world2", approve: true},
				type: "shutdown_response",
				recipient: "team-lead",
				request_id: "shutdown-177@world2",
				approve: true,
			},
		};
		const result = ContentBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it("parses a thinking block", () => {
		const block = {
			type: "thinking",
			thinking: "Let me analyze...",
			signature: "sig-abc",
		};
		const result = ThinkingBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.thinking).toBe("Let me analyze...");
		}
	});

	it("parses a tool_result block with string content", () => {
		const block = {
			type: "tool_result",
			tool_use_id: "tu_123",
			content: "file contents here",
		};
		const result = ToolResultBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it("parses a tool_result block with array content", () => {
		const block = {
			type: "tool_result",
			tool_use_id: "tu_123",
			content: [{type: "text", text: "line 1"}],
		};
		const result = ToolResultBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it("parses a tool_result with is_error flag", () => {
		const block = {
			type: "tool_result",
			tool_use_id: "tu_123",
			content: "not found",
			is_error: true,
		};
		const result = ToolResultBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.is_error).toBe(true);
		}
	});
});

const assistantMessageFields = {
	role: "assistant" as const,
	model: "claude-opus-4-6",
	id: "msg_123",
	type: "message",
	stop_reason: "end_turn",
	stop_sequence: null,
	usage: {input_tokens: 100, output_tokens: 50},
	stop_details: null,
};

describe("UserRecordSchema", () => {
	it("parses a user record with string content", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: "Fix the bug"},
		};
		const result = UserRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});

	it("parses a user record with array content", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {
				role: "user",
				content: [
					{type: "text", text: "Hello"},
					{type: "tool_result", tool_use_id: "tu_1", content: "result"},
				],
			},
		};
		const result = UserRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});

	it("accepts optional fields like slug", () => {
		const record = {
			type: "user",
			...baseFields,
			slug: "radiant-beaming-kay",
			message: {role: "user", content: "Hello"},
		};
		const result = UserRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});

	it("accepts queue priority metadata", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: "Background agents were stopped by the user."},
			promptSource: "system",
			queuePriority: "later",
			userFeedback: "Please preserve the current behavior.",
		};

		expect(UserRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("accepts the toolEndsTurn marker on turn-ending tool results", () => {
		const record = {
			type: "user",
			...baseFields,
			isSidechain: true,
			message: {
				role: "user",
				content: [{type: "tool_result", tool_use_id: "toolu_1", content: "Report delivered to your caller."}],
			},
			sourceToolAssistantUUID: "assistant-uuid-1",
			toolEndsTurn: true,
		};

		expect(UserRecordSchema.parse(record)).toStrictEqual(record);
	});
});

describe("AssistantRecordSchema", () => {
	it("parses an assistant record with content blocks", () => {
		const record = {
			type: "assistant",
			...baseFields,
			requestId: "req_123",
			message: {
				...assistantMessageFields,
				content: [
					{type: "text", text: "Here is my answer"},
					{
						type: "tool_use",
						id: "tu_1",
						name: "Read",
						input: {file_path: "/foo"},
					},
				],
			},
		};
		const result = AssistantRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});

	it("accepts optional fields like slug", () => {
		const record = {
			type: "assistant",
			...baseFields,
			requestId: "req_123",
			slug: "radiant-beaming-kay",
			effort: "high",
			healsDistinctCarrier: true,
			isAbortedMidStream: true,
			message: {
				...assistantMessageFields,
				content: [{type: "text", text: "Hi"}],
			},
		};
		expect(AssistantRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("accepts newer snake_case session_id metadata", () => {
		const record = {
			type: "assistant",
			...baseFields,
			session_id: "sess-123",
			requestId: "req_123",
			message: {
				...assistantMessageFields,
				content: [{type: "text", text: "Hi"}],
			},
		};
		const result = AssistantRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});
});

describe("AttachmentRecordSchema", () => {
	it.each([{}, {renderedBesideToolResult: true}, {renderedBesideToolResult: false}])(
		"preserves optional tool-result placement metadata: %j",
		(placement) => {
			const record = {
				type: "attachment",
				attachment: {type: "remote_session_change", url: null},
				rendered: [{content: "Example remote session reminder"}],
				renderedRole: "user",
				...placement,
			};

			expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
		},
	);

	it.each([null, "true", 1, {}, []])("rejects non-boolean tool-result placement metadata: %j", (placement) => {
		expect(
			JsonlRecordSchema.safeParse({
				type: "attachment",
				attachment: {type: "remote_session_change", url: null},
				renderedBesideToolResult: placement,
			}).success,
		).toBe(false);
	});

	it.each([
		{extra: true},
		{attachment: {type: "remote_session_change", renderedBesideToolResult: true}},
		{rendered: [{content: "Example remote session reminder", extra: true}]},
	])("keeps attachment envelopes and rendered content strict: %j", (extraFields) => {
		expect(
			JsonlRecordSchema.safeParse({
				type: "attachment",
				attachment: {type: "remote_session_change", url: null},
				renderedBesideToolResult: true,
				...extraFields,
			}).success,
		).toBe(false);
	});
});

describe("ProgressRecordSchema", () => {
	it("parses a progress record", () => {
		const record = {
			type: "progress",
			...baseFields,
			data: {type: "hook_progress", hookEvent: "SessionStart"},
		};
		const result = ProgressRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});
});

describe("SystemRecordSchema", () => {
	it.each([
		{},
		{preCompactArtifactReadVersions: []},
		{preCompactArtifactReadVersions: [{slug: "example-artifact", ver: "example-version"}]},
	])("parses compacted artifact read versions: %j", (artifactVersions) => {
		const record = {
			type: "system",
			subtype: "compact_boundary",
			compactMetadata: {trigger: "auto", preTokens: 100, ...artifactVersions},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses the precomputed compaction flag", () => {
		const record = {
			type: "system",
			subtype: "compact_boundary",
			compactMetadata: {
				trigger: "auto",
				preTokens: 968214,
				postTokens: 35371,
				durationMs: 270,
				precomputed: true,
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("rejects a non-boolean precomputed compaction flag", () => {
		expect(
			SystemRecordSchema.safeParse({
				type: "system",
				subtype: "compact_boundary",
				compactMetadata: {trigger: "auto", preTokens: 100, precomputed: "yes"},
			}).success,
		).toBe(false);
	});

	it.each([
		{preCompactArtifactReadVersions: {}},
		{preCompactArtifactReadVersions: ["example-artifact"]},
		{preCompactArtifactReadVersions: [{slug: "example-artifact", ver: 100}]},
		{preCompactArtifactReadVersions: [{slug: 100, ver: "example-version"}]},
		{preCompactArtifactReadVersions: [{slug: "example-artifact"}]},
		{preCompactArtifactReadVersions: [{slug: "example-artifact", ver: "example-version", extra: true}]},
		{preCompactArtifactReadVersions: [], extra: true},
	])("rejects malformed or unknown compacted artifact metadata: %j", (artifactVersions) => {
		expect(
			SystemRecordSchema.safeParse({
				type: "system",
				subtype: "compact_boundary",
				compactMetadata: {trigger: "auto", preTokens: 100, ...artifactVersions},
			}).success,
		).toBe(false);
	});

	it("parses a system record with subtype", () => {
		const record = {
			type: "system",
			...baseFields,
			subtype: "turn_duration",
			durationMs: 5000,
			preventContinuation: true,
		};

		expect(SystemRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses the request retry source", () => {
		const record = {
			type: "system",
			subtype: "api_error",
			source: "request_retry",
		};

		expect(SystemRecordSchema.parse(record)).toStrictEqual(record);
	});
});

describe("LastPromptRecordSchema", () => {
	it("parses a last-prompt record", () => {
		const record = {
			type: "last-prompt",
			lastPrompt: "Fix the login bug",
			explicit: true,
			sessionId: "sess-123",
		};

		expect(LastPromptRecordSchema.parse(record)).toStrictEqual(record);
	});
});

describe("QueueOperationRecordSchema", () => {
	it("parses a queue-operation record", () => {
		const record = {
			type: "queue-operation",
			operation: "enqueue",
			timestamp: "1999-12-31T00:00:00.000Z",
			sessionId: "sess-123",
			content: "task notification content",
		};
		const result = QueueOperationRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.operation).toBe("enqueue");
		}
	});
});

describe("JsonlRecordSchema", () => {
	it("parses hook-cancelled attachment records with timeout metadata", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "attachment",
			...baseFields,
			attachment: {
				type: "hook_cancelled",
				hookName: "PreToolUse:Bash",
				toolUseID: "toolu_100",
				hookEvent: "PreToolUse",
				command: "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse.py",
				durationMs: 10045,
				timedOut: true,
				timeoutMs: 10000,
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses team context attachments naming the agent and its team", () => {
		const record = {
			type: "attachment",
			attachment: {
				type: "team_context",
				agentId: "item-refiner-2@session-2102dbaf",
				agentName: "item-refiner-2",
				teamName: "session-2102dbaf",
				teamConfigPath: "/Users/craig/.claude/teams/session-2102dbaf/config.json",
				taskListPath: "/Users/craig/.claude/tasks/session-2102dbaf/",
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses subagent assistant records carrying the attributing agent type", () => {
		const record = {
			type: "assistant",
			...baseFields,
			isSidechain: true,
			agentId: "abd1368f74dfe3095",
			attributionAgent: "markdown-tasks:do-task",
			message: {role: "assistant", content: [{type: "text", text: "Working on it."}]},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses auto mode attachments with consent flow metadata", () => {
		const record = {
			type: "attachment",
			attachment: {
				type: "auto_mode",
				autoModeConsentFlow: false,
				bashFirst: false,
				steerOnly: false,
				bypass: false,
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses user records", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: "Hello"},
		};
		const result = JsonlRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});

	it("parses user records with current session and queue metadata", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "user",
			...baseFields,
			session_id: "session-100",
			queuePriority: "later",
			message: {role: "user", content: "Queued prompt"},
		});
		expect(result.success).toBe(true);
	});

	it("parses user records with tool denial metadata", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "user",
			...baseFields,
			message: {role: "user", content: []},
			toolUseResult: "Error: permission denied",
			toolDenialKind: "permission-rule",
		});
		expect(result.success).toBe(true);
	});

	it("parses user records interrupted by shutdown", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: "Continue the task"},
			interruptedByShutdown: true,
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses user records interrupted by send-now", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: [{type: "text", text: "[Request interrupted by user]"}]},
			interruptedBySendNow: true,
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses assistant records", () => {
		const record = {
			type: "assistant",
			...baseFields,
			requestId: "req_123",
			message: {
				...assistantMessageFields,
				content: [{type: "text", text: "Hi"}],
			},
		};
		const result = JsonlRecordSchema.safeParse(record);
		expect(result.success).toBe(true);
	});

	it("parses assistant records with snake_case session id", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "assistant",
			...baseFields,
			session_id: "sess-123",
			message: {
				...assistantMessageFields,
				content: [{type: "text", text: "Hi"}],
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses TaskCreate tool uses without a subject", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "assistant",
			...baseFields,
			message: {
				...assistantMessageFields,
				content: [
					{
						type: "tool_use",
						id: "toolu_123",
						name: "TaskCreate",
						input: {
							description: "Fill in the implementation details",
							activeForm: "Implementing",
						},
					},
				],
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses Agent tool uses with effort", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "assistant",
			...baseFields,
			message: {
				...assistantMessageFields,
				content: [
					{
						type: "tool_use",
						id: "toolu_123",
						name: "Agent",
						input: {
							prompt: "Inspect the code",
							model: "sonnet",
							effort: "high",
						},
					},
				],
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses custom-title records", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "custom-title",
			customTitle: "Title",
			sessionId: "sess-123",
		});
		expect(result.success).toBe(true);
	});

	it("parses progress records", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "progress",
			...baseFields,
			data: {type: "hook_progress"},
		});
		expect(result.success).toBe(true);
	});

	it("parses system records", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "system",
			...baseFields,
			subtype: "stop_hook_summary",
		});
		expect(result.success).toBe(true);
	});

	it("parses file-history-snapshot records", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "file-history-snapshot",
			messageId: "msg-123",
			isSnapshotUpdate: false,
			snapshot: {
				messageId: "msg-123",
				timestamp: "1999-12-31T00:00:00.000Z",
				trackedFileBackups: {},
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses last-prompt records", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "last-prompt",
			lastPrompt: "Fix it",
			sessionId: "sess-123",
		});
		expect(result.success).toBe(true);
	});

	it("parses queue-operation records", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "queue-operation",
			operation: "dequeue",
			timestamp: "1999-12-31T00:00:00.000Z",
			sessionId: "sess-123",
			content: "stuff",
		});
		expect(result.success).toBe(true);
	});

	it.each([{}, {reminderId: "example-reminder"}])(
		"parses queued command meta markers with optional reminder identity %j",
		(reminder) => {
			const record = {
				type: "attachment",
				...baseFields,
				attachment: {
					type: "queued_command",
					prompt: "Run the queued test command",
					commandMode: "prompt",
					timestamp: "1999-12-31T00:00:00.000Z",
					isMeta: true,
					...reminder,
				},
			};
			expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
		},
	);

	it.each([{reminderId: 100}, {unexpectedField: "example-value"}])(
		"rejects invalid queued command metadata %j",
		(metadata) => {
			const result = JsonlRecordSchema.safeParse({
				type: "attachment",
				...baseFields,
				attachment: {type: "queued_command", prompt: "Run the example command", ...metadata},
			});
			expect(result.success).toBe(false);
		},
	);

	it("parses dynamic skill attachments", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "attachment",
			...baseFields,
			attachment: {
				type: "dynamic_skill",
				skillDir: "/tmp/test/.claude/skills",
				skillNames: ["alice-skill"],
				displayPath: "test/.claude/skills",
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses async hook response attachments", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "attachment",
			...baseFields,
			attachment: {
				type: "async_hook_response",
				processId: "async-hook-100",
				hookName: "PreToolUse:Read",
				hookEvent: "PreToolUse",
				response: {decision: "allow"},
				stdout: "allowed",
				stderr: "",
				exitCode: 0,
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses already-read file attachments", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "attachment",
			...baseFields,
			attachment: {
				type: "already_read_file",
				filename: "/tmp/test/example.ts",
				displayPath: "example.ts",
				content: {type: "text"},
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses task status attachments", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "attachment",
			...baseFields,
			attachment: {
				type: "task_status",
				taskId: "task-100",
				taskType: "local_agent",
				description: "Example task",
				status: "completed",
				deltaSummary: null,
				outputFilePath: "/tmp/test/task-100.output",
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses task status attachments that can continue their agent", () => {
		const record = {
			type: "attachment",
			...baseFields,
			attachment: {
				type: "task_status",
				taskId: "task-100",
				taskType: "local_agent",
				description: "Example task",
				status: "running",
				deltaSummary: null,
				outputFilePath: "/tmp/test/task-100.output",
				canContinueAgent: true,
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("rejects a non-boolean canContinueAgent on task status attachments", () => {
		expect(
			JsonlRecordSchema.safeParse({
				type: "attachment",
				...baseFields,
				attachment: {type: "task_status", taskId: "task-100", status: "running", canContinueAgent: "yes"},
			}).success,
		).toBe(false);
	});

	it("parses total token reminder attachments", () => {
		const record = {
			type: "attachment",
			...baseFields,
			attachment: {
				type: "total_tokens_reminder",
				text: "<total_tokens>10000000 tokens left</total_tokens>",
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses fork context references", () => {
		const record = {
			type: "fork-context-ref",
			agentId: "agent-alice-100",
			parentSessionId: "session-alice-100",
			parentLastUuid: "message-alice-100",
			contextLength: 100,
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses relocated records", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "relocated",
			sessionId: "session-100",
			relocatedCwd: "/tmp/test/worktree",
		});
		expect(result.success).toBe(true);
	});

	it("parses worktree state with the pre-entry directory", () => {
		const record = {
			type: "worktree-state",
			sessionId: "session-100",
			worktreeSession: {
				originalCwd: "/tmp/test/project",
				preEnterOriginalCwd: "/tmp/test/project",
				worktreePath: "/tmp/test/worktree",
				worktreeName: "alice-worktree",
				worktreeBranch: "test/alice-worktree",
				sessionId: "session-100",
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses hook-based worktree state without a Git branch", () => {
		const record = {
			type: "worktree-state",
			sessionId: "session-100",
			worktreeSession: {
				originalCwd: "/tmp/test/project",
				preEnterOriginalCwd: "/tmp/test/project",
				worktreePath: "/tmp/test/worktree",
				worktreeName: "alice-worktree",
				sessionId: "session-100",
				hookBased: true,
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses user records with agentId (subagent sessions)", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "user",
			...baseFields,
			agentId: "agent-abc123def456",
			message: {role: "user", content: "Hello from subagent"},
		});
		expect(result.success).toBe(true);
	});

	it("parses assistant records with agentId (subagent sessions)", () => {
		const result = JsonlRecordSchema.safeParse({
			type: "assistant",
			...baseFields,
			agentId: "agent-abc123def456",
			requestId: "req_456",
			message: {
				...assistantMessageFields,
				content: [{type: "text", text: "Response from subagent"}],
			},
		});
		expect(result.success).toBe(true);
	});
});

describe("JsonlRecordSchema observed 2026-09 transcript fields", () => {
	const rendered = [{content: "<system-reminder>\nToday's date is 2026-09-28.\n</system-reminder>"}];

	function attachmentRecord(attachment: Record<string, unknown>) {
		return {type: "attachment", ...baseFields, attachment, rendered};
	}

	it("parses assistant records carrying wire metadata, per-turn effort, and input transformations", () => {
		const record = {
			type: "assistant",
			...baseFields,
			requestId: "req_1",
			advisorModel: "claude-opus-5-5",
			apiBlockIndex: 2,
			perTurnEffort: null,
			serverClassifierRequest: "931e5375-552d-4f2d-9c4c-4a60cd3903d0",
			truncatedAfterOutput: true,
			wireIngestContext: {toolu_1: {cwd: "/Users/test/project"}},
			wireToolInputs: {toolu_1: {command: "ls", description: "List files"}},
			message: {
				role: "assistant",
				content: [{type: "text", text: "Done."}],
				input_transformations: [
					{
						type: "thinking_dropped",
						path: "messages.2.content.0",
						reason: "prefix_binding_mismatch",
					},
				],
				safeguard_results: [
					{
						type: "dangerous_tool_use",
						status: {
							type: "available",
							tool_uses: {toolu_1: {type: "evaluated", outcome: "not_flagged"}},
						},
					},
				],
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses user records carrying the queueTranscriptOnly flag", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: "<task-notification>done</task-notification>"},
			origin: {kind: "task-notification"},
			promptSource: "system",
			queueSkipAttachments: true,
			queueTranscriptOnly: true,
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses artifact-watch task-notification user records carrying queueOrigin", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: "<task-notification>watch ended</task-notification>"},
			origin: {kind: "task-notification"},
			promptSource: "system",
			turnOrigin: "task_notification",
			queueOrigin: {
				kind: "task-notification",
				source: "artifact-watch-lifecycle",
				slug: "f305a5b4-dc1c-48bc-bcba-d1116eef516c",
				displayName: '"Review Decisions Round 2"',
				watchEnded: true,
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses peer-message user records carrying the queueSkipSlashCommands flag", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: "Another Claude session sent a message"},
			isMeta: true,
			promptSource: "system",
			queueSkipSlashCommands: true,
			turnOrigin: "peer",
			queueSkipAttachments: true,
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses harness-notice user records with a system turnOrigin", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: "[Cross-session idle notice] it is idle now"},
			isMeta: true,
			promptSource: "system",
			turnOrigin: "system",
			turnPosition: {promptIndex: 20, turnIndex: 67},
			queuePriority: "later",
			queueSkipAttachments: true,
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses SDK-submitted user records with an sdk turnOrigin", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: "Both PRs have GHA failures."},
			promptSource: "sdk",
			turnOrigin: "sdk",
			turnPosition: {promptIndex: 20, turnIndex: 72},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses a 2.1.301 api-request whose classifier_context has no artifacts", () => {
		const fixture = jsonlRecordFixtures["api-request"];
		const [safeguard] = fixture.params.safeguards;
		const {artifacts: _artifacts, ...classifierContext} = safeguard!.classifier_context;
		const record = {
			...fixture,
			params: {...fixture.params, safeguards: [{...safeguard!, classifier_context: classifierContext}]},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses subagent task-notification user records carrying joinedNotice arrays", () => {
		const record = {
			type: "user",
			...baseFields,
			agentId: "a80e3eb285d303168",
			message: {role: "user", content: "[SYSTEM NOTIFICATION - NOT USER INPUT]\nA background task finished."},
			isMeta: true,
			origin: {kind: "task-notification", producer: "session-task"},
			joinedNoticeLengths: [3837],
			joinedNoticeOwn: [true],
			joinedNoticeRunIds: ["0mvcr2ryk-c34fc2a3"],
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses user records carrying turn origin, scheduled-task, and classifier context fields", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: "hello"},
			promptSource: "suggestion_accepted",
			turnOrigin: "scheduled",
			turnPosition: {promptIndex: 1, turnIndex: 1},
			turnCompanion: true,
			queueSkipAttachments: true,
			scheduledTaskId: "cdaf9a4d",
			scheduledFireId: "26b2889b-5fe9-4a7b-ad8c-ed24a3678f56",
			classifierMetaLines: '{"meta":{"gitStatus":{"clean":true}}}\n',
			serverClassifierContext: {
				request: "931e5375-552d-4f2d-9c4c-4a60cd3903d0",
				context: {
					git_state: {
						cwd: "/Users/test/project",
						root: "/Users/test/project",
						branch: "main",
						default_branch: "main",
						status: {
							clean: false,
							counts: {staged: 0, modified: 2, untracked: null, untracked_normal: 1},
							porcelain: null,
							truncated: false,
						},
						visibility: {
							origin: {host: "github.com", remote: "test/project", visibility: "public"},
							push_remote: "origin",
							remotes: [
								{
									name: "origin",
									host: "github.com",
									remote: "test/project",
									visibility: "public",
								},
							],
							visibility_cache: [{host: "github.com", remote: "test/project", visibility: "public"}],
						},
					},
					live_cwd: "/Users/test/project",
					platform: "macos",
				},
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses classifier context whose git state is still pending", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: "hello"},
			serverClassifierContext: {
				request: "r1",
				context: {
					git_state: {
						cwd: "/tmp",
						root: null,
						branch: null,
						default_branch: null,
						status: null,
						visibility: null,
						error: "pending",
					},
					live_cwd: "/tmp",
					platform: "macos",
				},
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses system records for local commands, bridge status, and scheduled task fires", () => {
		const records = [
			{
				type: "system",
				...baseFields,
				subtype: "local_command",
				content: "<command-name>/rename</command-name>",
				commandRun: {command: "rename", args: "daily"},
			},
			{
				type: "system",
				...baseFields,
				subtype: "bridge_status",
				content: "Remote Control connected",
				url: "https://claude.ai/code/session_01",
			},
			{
				type: "system",
				...baseFields,
				subtype: "scheduled_task_fire",
				content: "Scheduled task fired",
				taskId: "cdaf9a4d",
				cron: "45 15 * * *",
				prompt: "/loop Check the PR",
				taskKind: "loop",
				cronKind: "loop",
				noOpStreak: 2,
				streakStartedAt: "2026-09-28T19:45:00.751Z",
				foldedUuids: ["26b2889b-5fe9-4a7b-ad8c-ed24a3678f56"],
			},
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	describe("/context structured twin on system/local_command", () => {
		const contextRecord = {
			type: "system",
			...baseFields,
			subtype: "local_command",
			content: "<local-command-stdout>## Context Usage\n\n**Model:** claude-opus-5-5</local-command-stdout>",
			commandRun: {command: "context", args: ""},
			contextUsage: {
				model: "claude-opus-5-5",
				total_tokens: 180_200,
				raw_max_tokens: 1_000_000,
				percentage: 18,
				over_limit: {tokens_over: 0, kind: "compaction_window"},
				categories: [
					{name: "System prompt", tokens: 3_100, kind: "used"},
					{name: "MCP tools", tokens: 41_000, kind: "deferred"},
					{name: "Messages", tokens: 143_500, kind: "used"},
					{name: "Autocompact buffer", tokens: 33_000, kind: "buffer"},
					{name: "Free space", tokens: 786_800, kind: "free"},
				],
				mcp_tools: [{name: "mcp__github__get_me", server_name: "github", tokens: 210}],
				memory_files: [{path: "/Users/me/.claude/CLAUDE.md", type: "User", tokens: 1_200}],
				agents: [{agent_type: "Explore", source: "built-in", tokens: 340}],
				skills: [
					{name: "commit", source: "plugin", plugin_name: "git", tokens: 90},
					{name: "deploy", source: "projectSettings", tokens: 40},
				],
			},
		};

		it("parses a full twin", () => {
			expect(JsonlRecordSchema.parse(contextRecord)).toStrictEqual(contextRecord);
		});

		it("rejects an unknown key inside a category", () => {
			const bad = {
				...contextRecord,
				contextUsage: {
					...contextRecord.contextUsage,
					categories: [{name: "Messages", tokens: 1, kind: "used", color: "promptBorder"}],
				},
			};
			expect(JsonlRecordSchema.safeParse(bad).success).toBe(false);
		});
	});

	it("parses queue removals that record why the prompt left the queue", () => {
		const record = {
			type: "queue-operation",
			operation: "remove",
			timestamp: "2026-09-28T00:00:00.000Z",
			sessionId: "s1",
			content: "queued prompt",
			reason: "absorbed_mid_turn",
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses queue removals that link the absorbed prompt to its command", () => {
		const record = {
			type: "queue-operation",
			operation: "remove",
			timestamp: "2026-09-29T00:00:00.000Z",
			sessionId: "s1",
			content: "queued prompt",
			reason: "absorbed_mid_turn",
			commandUuid: "7ddf351d-8b7a-47c8-bb4c-897e39f19328",
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses session bookkeeping records for bridges, costs, artifacts, and ATIS latches", () => {
		const records = [
			{type: "atis-latch", atis: "v1.f775a7368a120dff.MKr6", sessionId: "s1"},
			{
				type: "bridge-session",
				sessionId: "s1",
				bridgeSessionId: "cse_01",
				lastSequenceNum: 87,
				ownerAccountUuid: "acct-1",
				ownerOrganizationUuid: "org-1",
				noHistoryBackfill: true,
			},
			{
				type: "history-suppression",
				sessionId: "s1",
				cause: "chokepoint_veto",
				vetoedAgainstAccountUuid: "acct-1",
				ts: "2026-10-23T00:27:52.126Z",
			},
			{type: "history-suppression", sessionId: "s1", cause: "migration", ts: "2026-10-23T00:27:52.126Z"},
			{
				type: "history-suppression",
				sessionId: "s1",
				cause: "restored_owner_mismatch",
				vetoedAgainstAccountUuid: "acct-1",
				ts: "2026-10-28T12:23:37.792Z",
			},
			{
				type: "cost-state",
				sessionId: "s1",
				totalCostUSD: 1.5,
				totalAPIDuration: 1000,
				totalAPIDurationWithoutRetries: 990,
				totalToolDuration: 200,
				totalLinesAdded: 10,
				totalLinesRemoved: 2,
				totalDuration: 5000,
				startTime: 1790602944268,
				modelUsage: {
					"claude-opus-5-5": {
						inputTokens: 10,
						outputTokens: 20,
						thinkingTokens: 5,
						cacheReadInputTokens: 100,
						cacheCreationInputTokens: 50,
						cacheCreationEphemeral5mInputTokens: 30,
						cacheCreationEphemeral1hInputTokens: 20,
						webSearchRequests: 0,
						costUSD: 1.5,
					},
				},
				hasUnknownModelCost: false,
			},
			{
				type: "frame-link",
				sessionId: "s1",
				path: "/tmp/page.html",
				frameUrl: "https://claude.ai/code/artifact/abc",
				title: "Board Styles",
				artifactCount: 1,
				timestamp: "2026-09-28T17:22:33.770Z",
			},
			{
				type: "artifact-comment-monitor",
				v: 1,
				sessionId: "s1",
				artifacts: {
					"https://claude.ai/code/artifact/abc": {state: "armed", writtenAtMs: 1, title: "Board"},
				},
			},
			{
				type: "artifact-autoreact-ledger",
				v: 1,
				sessionId: "s1",
				accountUuid: "acct-1",
				artifacts: {
					"https://claude.ai/code/artifact/abc": {
						savedAt: 1,
						stampHighWater: null,
						everBaselined: true,
						everHadThreads: false,
						turnTimestamps: [],
						threads: [],
						interrupted: true,
					},
				},
			},
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses rendered context attachments for environment, instructions, model, and session context", () => {
		const records = [
			attachmentRecord({type: "date", date: "2026-09-28", changed: true}),
			attachmentRecord({
				type: "environment",
				snapshot: {
					workingDirectory: "/Users/test/project",
					isWorktree: false,
					isGitRepo: true,
					additionalWorkingDirectories: ["/Users/test/.claude"],
					platform: "darwin",
					shell: "zsh",
					osVersion: "Darwin 24.6.0",
					scratchpadDirectory: "/tmp/scratch",
				},
				changes: [
					{field: "workingDirectory", from: "/Users/test/other"},
					{field: "additionalWorkingDirectories", added: ["/Users/test/Downloads"], removed: []},
				],
			}),
			attachmentRecord({
				type: "instructions",
				files: [{path: "/Users/test/.claude/CLAUDE.md", type: "User", content: "Be terse."}],
				changed: true,
				reason: "session_start",
				removed: ["/Users/test/project/AGENTS.md"],
			}),
			attachmentRecord({
				type: "model",
				identity: {
					modelId: "claude-opus-5-5",
					marketingName: "Opus 5.5",
					knowledgeCutoff: "June 2026",
				},
				text: "You are powered by the model named Opus 5.5.",
			}),
			attachmentRecord({
				type: "session_context",
				context: {userEmail: "The user's email is test@example.com."},
			}),
			attachmentRecord({type: "credential_org", organizationUuid: "org-1"}),
			attachmentRecord({type: "output_style", style: "Concise", turnReminder: "Be concise."}),
			attachmentRecord({
				type: "output_style_instructions",
				style: {name: "Concise", prompt: "Keep it short."},
			}),
			attachmentRecord({
				type: "remote_session_change",
				url: null,
				commit: "",
				pr: "",
				sendUserFileHint: true,
				managedCommit: false,
				managedPr: false,
			}),
			attachmentRecord({type: "fork_briefing", text: "This conversation was forked."}),
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses a session_context refresh announcement carrying changed and reason", () => {
		const record = attachmentRecord({
			type: "session_context",
			context: {userEmail: "The user's email is test@example.com."},
			changed: true,
			reason: "session_start",
		});

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("rejects a context refresh reason outside the CLI's closed set", () => {
		const records = [
			attachmentRecord({type: "session_context", context: {}, changed: true, reason: "made_up_reason"}),
			attachmentRecord({type: "instructions", files: [], changed: true, reason: "made_up_reason"}),
		];

		expect(records.map((record) => JsonlRecordSchema.safeParse(record).success)).toStrictEqual([false, false]);
	});

	it("parses a model attachment whose identity is unknown for an unrecognized --model", () => {
		const record = {
			...attachmentRecord({
				type: "model",
				identity: {modelId: "claude-nonexistent-model-9", marketingName: null, knowledgeCutoff: null},
				text: "You are powered by the model claude-nonexistent-model-9.",
			}),
			rendered: [
				{
					content:
						"<system-reminder>\nYou are powered by the model claude-nonexistent-model-9.\n</system-reminder>",
				},
			],
			renderedRole: "system",
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses prompt snapshot and deferred tool record attachments", () => {
		const records = [
			attachmentRecord({
				type: "prompt_snapshot",
				systemPrompt: ["You are an interactive agent.", "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"],
				reminderFold: false,
				echoWireToolInputs: true,
				contextRendering: "announced",
				tools: [{name: "Bash", description: "Run a command", schema: {type: "object"}}],
				cliPrefix: "You are Claude Code.",
				systemTurns: true,
				toolChangeHeader: true,
				inlineTools: false,
				keptReminders: true,
				hostPrompt: "f7a1a5925fe3c21c",
			}),
			attachmentRecord({
				type: "deferred_tools_record",
				entries: [
					{
						name: "mcp__docs__guide",
						description: "Docs guides",
						input_schema: {type: "object", properties: {}},
						eager_input_streaming: true,
						defer_loading: true,
					},
				],
				toolInputCopies: [{id: "toolu_1", copy: "wire"}],
				nameOnlyAnnouncements: ["e1a46492-d54a-4f2b-94a3-82a1c5c174cf"],
			}),
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses requested models, permission decisions, surfaced tool definitions, run ids, git status, skill mentions, and dev-mods records", () => {
		const records = [
			{
				type: "assistant",
				...baseFields,
				requestedModel: "claude-opus-5-5",
				message: {role: "assistant", model: "claude-opus-5-5", content: [{type: "text", text: "Done."}]},
			},
			{
				type: "user",
				...baseFields,
				message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_1", content: "ok"}]},
				permissionDecision: {decision: "accept", source: "config", reasonType: "rule"},
			},
			{
				type: "user",
				...baseFields,
				message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_2", content: "no"}]},
				permissionDecision: {decision: "reject", source: "user_temporary"},
			},
			{
				type: "user",
				...baseFields,
				message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_3", content: "blocked"}]},
				permissionDecision: {decision: "reject", source: "config", reasonType: "safetyCheck"},
			},
			{
				type: "user",
				...baseFields,
				message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_4", content: "rejected"}]},
				permissionDecision: {decision: "reject", source: "user_reject"},
			},
			attachmentRecord({
				type: "deferred_tools_delta",
				surfacedNames: ["mcp__docs__guide"],
				surfacedDefinitions: [
					{
						name: "mcp__docs__guide",
						listing: "1f2c30a590811b06",
						definition: {
							name: "mcp__docs__guide",
							description: "Docs guides",
							input_schema: {type: "object", properties: {}},
							eager_input_streaming: true,
						},
					},
				],
			}),
			attachmentRecord({type: "queued_command", prompt: "next", runId: "0mv136l2s-e0862bf6"}),
			attachmentRecord({
				type: "session_context",
				context: {userEmail: "test@example.com", gitStatus: "Current branch: main\n\nStatus:\n(clean)"},
			}),
			attachmentRecord({type: "skill_mention", skillName: "build:test-branch"}),
			attachmentRecord({
				type: "inlined_image_paths",
				paths: ["/Users/test/.claude/uploads/sess-123/56ef1955-image.png"],
			}),
			{type: "dev-mods", folder: "/tmp/dev-mods/sess-123", sessionId: "sess-123"},
			{type: "tools-used", tools: ["Bash"], sessionId: "sess-123"},
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses turn-level reminder and thinking attachments", () => {
		const records = [
			attachmentRecord({type: "bash_output_audience_note", toolUseID: "toolu_1"}),
			attachmentRecord({
				type: "batching_reminder_sent",
				text: "First privately list what you need next.",
				model: "claude-fable-5-1",
				clearAt: "next_user_message",
			}),
			attachmentRecord({type: "silent_turn_reminder", text: "Say what you're doing."}),
			attachmentRecord({
				type: "hook_permission_decision",
				decision: "allow",
				toolUseID: "toolu_1",
				hookEvent: "PermissionRequest",
			}),
			attachmentRecord({type: "thinking_stripped", scope: "all"}),
			attachmentRecord({
				type: "structured_output",
				toolUseID: "toolu_1",
				data: {investigated: true, taskCount: 5, discovered: [{slug: "top-bar", priority: "P3"}], note: null},
			}),
			attachmentRecord({
				type: "thinking_drop",
				requestId: "req_1",
				model: "claude-opus-5-5",
				querySource: "repl_main_thread",
				thinkingBlocksSent: 15,
				thinkingTurnsSent: 14,
				newlyDropped: {
					blockCount: 15,
					turnCount: 14,
					reason: "prefix_mismatch",
					first: {messageIndex: 2, blockIndex: 0},
					last: {messageIndex: 87, blockIndex: 1},
					reasonCounts: {prefix_mismatch: 15},
				},
				blockHashes: ["2gdd6tokolerh"],
				firstReportForThreadInProcess: false,
				clientChange: {
					kinds: "toolSchemasChanged",
					firstChangedMessageIndex: -1,
					baseline: "memory",
					callNumber: 33,
				},
			}),
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses new fields on existing attachment types", () => {
		const records = [
			attachmentRecord({type: "auto_mode", bashFirstSteer: "relaxed"}),
			attachmentRecord({type: "auto_mode_exit", bashFirst: true, steerOnly: true}),
			attachmentRecord({
				type: "deferred_tools_delta",
				addedNames: ["Edit"],
				wireHiddenNames: [],
				surfacedNames: ["Edit"],
				restoredNames: ["Edit"],
				retractedTools: [{name: "Edit", cause: "denied"}],
				failedMcpServers: [{name: "imcp", errorCode: "CONNECT_TIMEOUT", error: "timed out"}],
			}),
			attachmentRecord({
				type: "deferred_tools_delta",
				removedNames: ["mcp__docs__guide"],
				removedByBlock: ["mcp__docs__guide"],
			}),
			attachmentRecord({
				type: "deferred_tools_delta",
				surfacedNames: ["mcp__docs__guide"],
				surfacedDefinitions: [
					{
						name: "mcp__docs__guide",
						listing: "1f2c30a590811b06",
						sameAs: "398d17b2-379f-4a8c-9d42-6180faf07536",
					},
				],
			}),
			attachmentRecord({
				type: "file",
				filename: "/Users/test/.claude/memory/note.md",
				readNotes: {memoryNote: "This memory is 7 days old."},
			}),
			attachmentRecord({
				type: "task_status",
				taskId: "b80edgxim",
				status: "running",
				shell: {command: "sleep 300", kind: "bash", toolUseId: "toolu_1"},
			}),
			attachmentRecord({
				type: "team_context",
				agentName: "commit-handler",
				hasTaskListTools: false,
			}),
			{
				...attachmentRecord({
					type: "queued_command",
					prompt: "notification",
					source_uuid: "c42a1d7d-1f5e-421f-84d3-437bde0eadb1",
					humanTurn: true,
					toolsUsedDelta: ["SubagentHandback"],
					usage: {totalTokens: 83518, toolUses: 3, durationMs: 21780},
				}),
				renderedInHumanTurn: [{content: "<system-reminder>\nnotification\n</system-reminder>"}],
			},
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses 2.1.300 api-request, api-request-blob, and api-request-shape records and assistant requestRef", () => {
		const gitState = {
			cwd: "/Users/test/project",
			root: "/Users/test/project",
			branch: "main",
			default_branch: null,
			status: {
				clean: false,
				counts: {staged: 0, modified: 2, untracked: null, untracked_normal: 1},
				porcelain: null,
				truncated: false,
			},
			visibility: {
				origin: {host: "github.com", remote: "origin", visibility: "public"},
				push_remote: "origin",
				remotes: [{name: "origin", host: "github.com", remote: "origin", visibility: "public"}],
				visibility_cache: [{host: "github.com", remote: "origin", visibility: "public"}],
			},
		};
		const records = [
			{
				type: "assistant",
				...baseFields,
				requestRef: "a8385a7e-4125-443c-9712-789f57569497",
				message: {role: "assistant", model: "claude-opus-5-5", content: [{type: "text", text: "Done."}]},
			},
			{
				type: "api-request-shape",
				sessionId: "sess-123",
				timestamp: "2026-10-14T21:24:41.805Z",
				version: "2.1.300",
				shapeHash: "ba8bc7e4",
				shape: {
					system: [{type: "text", text: "You are Claude Code."}],
					tools: [
						{
							name: "Read",
							description: "Reads a file.",
							input_schema: {type: "object", properties: {file_path: {type: "string"}}},
							eager_input_streaming: true,
						},
						{
							name: "mcp__docs__guide",
							description: "Docs guides",
							input_schema: {type: "object", properties: {}},
							defer_loading: true,
						},
						{type: "advisor_20260301", name: "advisor", model: "claude-opus-5-5", defer_loading: true},
					],
				},
			},
			{
				type: "api-request-blob",
				sessionId: "sess-123",
				hash: "83f236db",
				message: {
					role: "assistant",
					output_config: {effort: "medium"},
					content: [
						{type: "thinking", thinking: "Plan.", signature: "sig"},
						{type: "text", text: "Reading."},
						{
							type: "tool_use",
							id: "toolu_1",
							name: "Read",
							input: {file_path: "/a"},
							caller: {type: "direct"},
						},
					],
				},
			},
			{
				type: "api-request-blob",
				sessionId: "sess-123",
				hash: "55257536",
				message: {
					role: "user",
					content: [
						{type: "tool_result", tool_use_id: "toolu_1", content: "ok", is_error: false},
						{
							type: "tool_addition",
							tool: {
								type: "tool_definition",
								definition: {
									name: "mcp__docs__update",
									description: "Edit a tab.",
									input_schema: {type: "object", properties: {}},
									eager_input_streaming: true,
								},
							},
						},
					],
				},
			},
			{
				type: "api-request-blob",
				sessionId: "sess-123",
				hash: "69c94cc0",
				message: {role: "system", content: [{type: "text", text: "Reminder."}]},
			},
			{
				type: "api-request",
				sessionId: "sess-123",
				id: "a8385a7e-4125-443c-9712-789f57569497",
				timestamp: "2026-10-14T21:24:41.805Z",
				version: "2.1.300",
				querySource: "repl_main_thread",
				shapeHash: "ba8bc7e4",
				base: "4f2f2830-b1cd-4aa8-9062-e26619000000",
				params: {
					model: "claude-opus-5-5",
					betas: ["claude-code-20250219", "oauth-2025-04-20"],
					max_tokens: 128000,
					thinking: {type: "adaptive", display: "updates"},
					context_management: {edits: [{type: "clear_thinking_20251015", keep: "all"}]},
					safeguards: [
						{
							type: "dangerous_tool_use",
							classifier_context: {
								v: 1,
								permission_mode: "auto",
								platform: "macos",
								live_cwd: "/Users/test/project",
								home_dir: "/Users/test",
								rule_roots: {
									userSettings: "/Users/test/.claude",
									projectSettings: "/Users/test/project",
									localSettings: "/Users/test/project",
									flagSettings: "/Users/test/project",
									policySettings: "/Users/test/project",
									cliArg: "/Users/test/project",
									command: "/Users/test/project",
									session: "/Users/test/project",
									toolsNarrowing: "/Users/test/project",
									mcpServerPolicy: "/Users/test/project",
									hostCredential: "/Users/test/project",
								},
								trusted_directories: {
									primary: {path: "/Users/test/project", resolved: ["/Users/test/project"]},
									additional: [],
									network: [],
									block_reads_outside_working_directories: false,
								},
								rules: {
									allow: [{rule: "Bash(cat:*)", source: "userSettings"}],
									deny: [
										{rule: "Bash(git add -A:*)", source: "userSettings"},
										{
											rule: "Read(~/.ssh/**)",
											source: "userSettings",
											pattern: "/.ssh/**",
											root: "/Users/test",
										},
									],
									ask: [
										{rule: "Bash(gh:*)", source: "userSettings"},
										{
											rule: "Edit(//etc/**)",
											source: "userSettings",
											pattern: "/etc/**",
											root: null,
										},
									],
								},
								auto_mode: {
									allow: ["$defaults", "Bash(vp test:*)"],
									soft_deny: ["$defaults", "Bash(sqlite3 * -- DROP*)"],
									hard_deny: [],
									environment: ["### Org-wide"],
								},
								artifact_consent_holdback: true,
								case_insensitive_paths: false,
								restricted: false,
								is_remote_mode: false,
								classify_all_shell: false,
								user_identity: "test",
								dropped: {allow: 114},
								git_state: {
									cwd: "/Users/test/project",
									root: null,
									branch: null,
									default_branch: null,
									status: null,
									visibility: null,
									error: "pending",
								},
								artifacts: {
									by_slug: {},
									by_path: {},
									live_docs: [],
									room_armed: [],
									type_reads: {},
									session: {
										frame_env: "prod",
										viewer_origin: "https://claude.ai",
										short_links: true,
										ant_build: false,
										comments_in_schema: true,
										handlers: false,
										room_client: false,
										eval_stub: false,
										scratchpad_dir: "/tmp/scratchpad",
										tool_results_dir: "/tmp/tool-results",
										toolset: true,
										live_edit: false,
										live_doc_stream: false,
										live_paths_schema: false,
										copy_from: true,
										db_str_replace: true,
										types_on: true,
										five_class_asks: true,
										watch_rail: "live",
										auto_react: true,
									},
								},
								system_reminders: [{id: "c900d357d5009e11", provenance: "peer"}],
								prior_turn_context: [
									{
										tool_use_ids: ["toolu_1"],
										context: {
											git_state: gitState,
											live_cwd: "/Users/test/project",
											platform: "macos",
										},
									},
								],
							},
						},
					],
					output_config: {effort: "medium"},
				},
				keep: 0,
				tail: ["83f236db"],
				cacheControl: [
					{path: ["system", 1], value: {type: "ephemeral", ttl: "1h", scope: "global"}},
					{path: ["messages", 1, "content", 3], value: {type: "ephemeral", ttl: "1h"}},
				],
				requestDigest: "ffb6a6a3",
			},
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses an api-request without safeguards and api-request-blob messages with string content", () => {
		const records = [
			{
				type: "api-request-blob",
				sessionId: "sess-123",
				hash: "25e08ea4",
				message: {role: "user", content: "Rebase onto 2.11.0."},
			},
			{
				type: "api-request-blob",
				sessionId: "sess-123",
				hash: "71ac09b2",
				message: {role: "system", content: "Reminder."},
			},
			{
				type: "api-request",
				sessionId: "sess-123",
				id: "3b9b75b8-50b9-467f-ae1d-b65adecd16c7",
				timestamp: "2026-10-15T14:12:19.318Z",
				version: "2.1.300",
				querySource: "repl_main_thread",
				shapeHash: "9402313c",
				params: {
					model: "claude-sonnet-5-5",
					betas: ["claude-code-20250219"],
					max_tokens: 128000,
					thinking: {type: "adaptive", display: "updates"},
					context_management: {edits: [{type: "clear_thinking_20251015", keep: "all"}]},
					output_config: {effort: "medium"},
				},
				keep: 0,
				tail: ["25e08ea4"],
				cacheControl: [{path: ["system", 2], value: {type: "ephemeral", ttl: "1h"}}],
				requestDigest: "65a15150",
			},
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses api-request-blob tool_addition blocks that reference a tool by name", () => {
		const record = {
			type: "api-request-blob",
			sessionId: "sess-123",
			hash: "a61841f4",
			message: {
				role: "system",
				content: [
					{type: "text", text: "Called the Read tool with the following input"},
					{type: "tool_addition", tool: {type: "tool_reference", name: "ReadNotifications"}},
					{type: "tool_addition", tool: {type: "tool_reference", name: "mcp__claude_ai_Claude_Docs__batch"}},
				],
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses subagent api-request, api-request-blob, and api-request-shape records carrying agentId", () => {
		const records = [
			{...jsonlRecordFixtures["api-request-shape"], agentId: "a37df3f20484177f0"},
			{...jsonlRecordFixtures["api-request-blob"], agentId: "a37df3f20484177f0"},
			{...jsonlRecordFixtures["api-request"], agentId: "a37df3f20484177f0"},
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses api-request cacheControl breakpoints without a ttl", () => {
		const record = {
			...jsonlRecordFixtures["api-request"],
			cacheControl: [
				{path: ["system", 0], value: {type: "ephemeral"}},
				{path: ["messages", 1, "content", 0], value: {type: "ephemeral", ttl: "1h"}},
			],
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses a synthetic usage-limit assistant record with apiError, apiErrorParams, and quotaLimits", () => {
		const rateLimitInfo = {
			status: "rejected",
			resetsAt: 1792483200,
			rateLimitType: "seven_day",
			overageStatus: "rejected",
			overageDisabledReason: "org_level_disabled",
			isUsingOverage: false,
		};
		const record = {
			type: "assistant",
			...baseFields,
			message: {
				id: "4b65b42d-71c4-4be0-9005-3d8d458b4872",
				model: "<synthetic>",
				role: "assistant",
				stop_reason: "stop_sequence",
				stop_sequence: "",
				type: "message",
				content: [{type: "text", text: "You've hit your weekly limit"}],
			},
			requestId: "req_011Cg3pEHpUjuhh73o5x6V6z",
			apiError: "usage_limit_reached",
			apiErrorParams: {rate_limit_info: rateLimitInfo},
			quotaLimits: {
				...rateLimitInfo,
				unifiedRateLimitFallbackAvailable: false,
				upgradePaths: ["overage"],
			},
			error: "rate_limit",
			isApiErrorMessage: true,
			apiErrorStatus: 429,
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses a synthetic stream-cut assistant error record with streamCutCause", () => {
		const record = {
			type: "assistant",
			...baseFields,
			message: {
				id: "c26da95a-ca87-43a8-b66f-b1af0e4e4a6a",
				model: "<synthetic>",
				role: "assistant",
				stop_reason: "stop_sequence",
				stop_sequence: "",
				type: "message",
				content: [
					{
						type: "text",
						text: "API Error: Your computer went to sleep mid-response. The response above may be incomplete.",
					},
				],
			},
			error: "server_error",
			isApiErrorMessage: true,
			streamCutCause: "stream_suspended",
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});
});

describe("JsonlRecordSchema observed 2026-10-21 transcript fields", () => {
	const rendered = [{content: "<system-reminder>\nToday's date is 2026-10-21.\n</system-reminder>"}];

	function attachmentRecord(attachment: Record<string, unknown>) {
		return {type: "attachment", ...baseFields, attachment, rendered};
	}

	it("parses agent and skill listings carrying plugin built-ins and skill digests", () => {
		const records = [
			attachmentRecord({
				type: "agent_listing_delta",
				addedTypes: ["claude"],
				addedLines: ["- claude: Catch-all agent"],
				builtInTypes: ["claude", "Explore"],
				builtInPluginTypes: ["code-simplifier:code-simplifier"],
				removedTypes: [],
				isInitial: true,
				showConcurrencyNote: true,
			}),
			attachmentRecord({
				type: "skill_listing",
				content: "- goal-sloc",
				skillCount: 1,
				isInitial: true,
				names: ["goal-sloc"],
				digests: ["4b64b81bd286b154"],
			}),
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses session_cron_carry attachments listing the carried-over cron tasks", () => {
		const record = attachmentRecord({
			type: "session_cron_carry",
			tasks: [
				{
					id: "9672e493",
					cron: "7 13 19 10 *",
					prompt: "Restore the .envrc references",
					createdAt: 1792343284261,
					recurring: false,
				},
			],
		});

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses images inside api-request-blob messages", () => {
		const record = {
			type: "api-request-blob",
			sessionId: "sess-123",
			hash: "4982b2e37b59919472b275f6e7477afe1d938ad6409609cbfd9c7eed24ad54ab",
			message: {
				role: "user",
				content: [
					{type: "text", text: "I got [Image #1]"},
					{type: "image", source: {type: "base64", media_type: "image/png", data: "iVBORw0KGgo="}},
				],
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses safety-classifier refusal records", () => {
		const records = [
			{
				type: "user",
				...baseFields,
				message: {role: "user", content: "Your response above was stopped by a safety classifier."},
				isMeta: true,
				turnCompanion: true,
				refusedMessageId: "msg_011CgFad5GTxt69LeKVCXRBB",
			},
			{
				type: "assistant",
				...baseFields,
				message: {role: "assistant", model: "<synthetic>", content: [{type: "text", text: "API Error"}]},
				requestId: "req_011CgFaXu4vBJjAD4zM5mZ3W",
				error: "invalid_request",
				isApiErrorMessage: true,
				refusedMessageId: "msg_011CgFaXuKJXxjEoQpSSFwXn",
			},
			{
				type: "system",
				...baseFields,
				subtype: "model_refusal_no_fallback",
				content: "",
				level: "warning",
				originalModel: "claude-sonnet-5-5",
				requestId: "req_011CgFaXu4vBJjAD4zM5mZ3W",
				apiRefusalCategory: "cyber",
				apiRefusalExplanation: "This request triggered restrictions on violative cyber content.",
				refusedUserMessageUuid: "06ac5d00-1f7a-4e96-a16b-462c368c8aeb",
				isMeta: false,
			},
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses permission rule sources, sandboxed tool results, and auto-mode finish-exposed-work flags", () => {
		const records = [
			{
				type: "user",
				...baseFields,
				message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_1", content: "ok"}]},
				permissionDecision: {
					decision: "accept",
					source: "config",
					reasonType: "rule",
					ruleSource: "userSettings",
				},
			},
			{
				type: "user",
				...baseFields,
				message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_2", content: "ok"}]},
				sandboxed: false,
				permissionDecision: {decision: "accept", source: "config", reasonType: "classifier"},
			},
			attachmentRecord({
				type: "auto_mode",
				autoModeConsentFlow: false,
				finishExposedWork: false,
				bashFirst: true,
				bashFirstSteer: "relaxed",
				steerOnly: true,
				bypass: false,
			}),
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses permission decisions carrying a grant scope and reason code", () => {
		const records = [
			{
				type: "user",
				...baseFields,
				message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_1", content: "ok"}]},
				permissionDecision: {
					decision: "accept",
					source: "user_temporary",
					grantScope: "once",
					reasonCode: "unknown",
				},
			},
			{
				type: "user",
				...baseFields,
				message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_2", content: "ok"}]},
				permissionDecision: {
					decision: "accept",
					source: "user_temporary",
					grantScope: "session",
					reasonCode: "rule:userSettings",
				},
			},
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("rejects an unknown permission grant scope", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_1", content: "ok"}]},
			permissionDecision: {decision: "accept", source: "user_permanent", grantScope: "forever"},
		};

		expect(JsonlRecordSchema.safeParse(record).success).toBe(false);
	});

	it("rejects an unknown permission rule source", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_1", content: "ok"}]},
			permissionDecision: {
				decision: "accept",
				source: "config",
				reasonType: "rule",
				ruleSource: "madeUpSettings",
			},
		};

		expect(JsonlRecordSchema.safeParse(record).success).toBe(false);
	});

	it("parses joined background-task notices whose run id is null", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: "[SYSTEM NOTIFICATION - NOT USER INPUT]"},
			isMeta: true,
			origin: {kind: "task-notification", producer: "session-task"},
			joinedNoticeLengths: [283, 120],
			joinedNoticeOwn: [true, false],
			joinedNoticeRunIds: [null, "0mv136l2s-e0862bf6"],
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses assistant records whose thinking display is omitted", () => {
		const record = {
			type: "assistant",
			...baseFields,
			message: {
				role: "assistant",
				model: "claude-opus-5-5",
				content: [{type: "thinking", thinking: "", signature: "CAQSrwQK"}],
			},
			thinkingDisplay: "omitted",
			thinkingDurationMs: 871,
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});
});

describe("JsonlRecordSchema observed 2026-10-22 permission decisions", () => {
	function toolResultRecord(permissionDecision: Record<string, unknown>) {
		return {
			type: "user",
			...baseFields,
			message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_1", content: "denied"}]},
			permissionDecision,
		};
	}

	it("parses permission decisions carrying a classifier category, circuit breaker, abort source and new reason types", () => {
		const records = [
			toolResultRecord({
				decision: "reject",
				source: "config",
				reasonType: "classifier",
				reasonCode: "classifier:auto-mode",
				classifierCategory: "third_party_attack",
			}),
			toolResultRecord({
				decision: "reject",
				source: "config",
				reasonType: "classifier",
				classifierCategory: "cowork_folder_access",
			}),
			toolResultRecord({
				decision: "reject",
				source: "config",
				reasonType: "safetyCheck",
				reasonCode: "unknown",
				circuitBreaker: "dangerousRemoval",
			}),
			toolResultRecord({decision: "reject", source: "user_abort"}),
			toolResultRecord({decision: "reject", source: "config", reasonType: "asyncAgent"}),
			toolResultRecord({decision: "accept", source: "config", reasonType: "sandboxOverride"}),
			toolResultRecord({decision: "reject", source: "config", reasonType: "workingDir"}),
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("rejects an unknown classifier category", () => {
		const record = toolResultRecord({decision: "reject", source: "config", classifierCategory: "made_up"});

		expect(JsonlRecordSchema.safeParse(record).success).toBe(false);
	});

	it("rejects an unknown circuit breaker", () => {
		const record = toolResultRecord({decision: "reject", source: "config", circuitBreaker: "madeUp"});

		expect(JsonlRecordSchema.safeParse(record).success).toBe(false);
	});
});

describe("parseJsonlRecord", () => {
	it("parses valid JSON and returns typed record", () => {
		const line = JSON.stringify({
			type: "user",
			...baseFields,
			message: {role: "user", content: "Hello"},
		});
		const result = parseJsonlRecord(line);
		expect(result).not.toBe(null);
		expect(result!.type).toBe("user");
	});

	it("returns null for malformed JSON", () => {
		expect(parseJsonlRecord("not json")).toBe(null);
	});

	it("returns null for empty line", () => {
		expect(parseJsonlRecord("")).toBe(null);
		expect(parseJsonlRecord("   ")).toBe(null);
	});

	it("returns null for unknown record types (strict schema rejects them)", () => {
		const line = JSON.stringify({type: "unknown-future-type", data: "stuff"});
		const result = parseJsonlRecord(line);
		expect(result).toBe(null);
	});
});

describe("TaskFileSchema", () => {
	it("parses a valid task", () => {
		const task = {
			id: "1",
			subject: "Fix the login bug",
			description: "Auth is broken",
			status: "pending",
			blocks: [],
			blockedBy: [],
		};
		const result = TaskFileSchema.safeParse(task);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.subject).toBe("Fix the login bug");
			expect(result.data.status).toBe("pending");
		}
	});

	it("parses a task with dependencies", () => {
		const task = {
			id: "2",
			subject: "Write tests",
			description: "Add test coverage",
			status: "pending",
			blocks: ["3"],
			blockedBy: ["1"],
			activeForm: "Writing tests",
		};
		const result = TaskFileSchema.safeParse(task);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.blocks).toStrictEqual(["3"]);
			expect(result.data.blockedBy).toStrictEqual(["1"]);
			expect(result.data.activeForm).toBe("Writing tests");
		}
	});

	it("accepts all valid status values", () => {
		for (const status of ["pending", "in_progress", "completed"]) {
			const result = TaskFileSchema.safeParse({
				id: "1",
				subject: "task",
				description: "desc",
				status,
				blocks: [],
				blockedBy: [],
			});
			expect(result.success).toBe(true);
		}
	});

	it("rejects invalid status", () => {
		const result = TaskFileSchema.safeParse({
			id: "1",
			subject: "task",
			description: "desc",
			status: "done",
			blocks: [],
			blockedBy: [],
		});
		expect(result.success).toBe(false);
	});

	it("accepts persisted task metadata", () => {
		const result = TaskFileSchema.safeParse({
			id: "1",
			subject: "task",
			description: "desc",
			status: "completed",
			blocks: [],
			blockedBy: [],
			metadata: {
				commit_sha: "769a03b2",
				tests_added: 11,
				verification: {status: "passed"},
			},
		});
		expect(result.success).toBe(true);
	});

	it("accepts persisted task owner and metadata", () => {
		const result = TaskFileSchema.safeParse({
			id: "1",
			subject: "task",
			description: "desc",
			status: "pending",
			blocks: [],
			blockedBy: [],
			owner: "agent-1",
			metadata: {priority: "high"},
		});
		expect(result.success).toBe(true);
	});

	it("accepts metadata with arbitrary JSON values", () => {
		const result = TaskFileSchema.safeParse({
			id: "1",
			subject: "task",
			description: "desc",
			status: "pending",
			blocks: [],
			blockedBy: [],
			metadata: {priority: "high"},
		});
		expect(result.success).toBe(true);
	});

	it("rejects unknown fields", () => {
		const result = TaskFileSchema.safeParse({
			id: "1",
			subject: "task",
			description: "desc",
			status: "pending",
			blocks: [],
			blockedBy: [],
			extraField: true,
		});
		expect(result.success).toBe(false);
	});
});

describe("TaskFileSchema against disk", () => {
	const tasksDir = join(homedir(), ".claude", "tasks");

	it("validates all task files on disk", () => {
		let projectDirs: string[];
		try {
			projectDirs = readdirSync(tasksDir);
		} catch {
			return;
		}

		let validated = 0;
		const failures: string[] = [];

		for (const projectDir of projectDirs) {
			const projectPath = join(tasksDir, projectDir);
			let st: ReturnType<typeof statSync>;
			try {
				st = statSync(projectPath);
			} catch {
				continue;
			}
			if (!st.isDirectory()) continue;

			const files = readdirSync(projectPath).filter((f) => f.endsWith(".json"));
			for (const file of files) {
				const filePath = join(projectPath, file);
				const raw = readFileSync(filePath, "utf-8");
				let parsed: unknown;
				try {
					parsed = JSON.parse(raw);
				} catch {
					failures.push(`${projectDir}/${file}: invalid JSON`);
					continue;
				}

				const result = TaskFileSchema.safeParse(parsed);
				if (result.success) {
					validated++;
				} else {
					failures.push(`${projectDir}/${file}: ${result.error.issues.map((i) => i.message).join(", ")}`);
				}
			}
		}

		if (failures.length > 0) {
			throw new Error(`${failures.length} task files failed validation:\n${failures.join("\n")}`);
		}

		expect(validated).toBeGreaterThan(0);
	});
});

describe("JsonlRecordSchema observed on the work machine 2026-10-22", () => {
	const rendered = [{content: "<system-reminder>\nToday's date is 2026-10-22.\n</system-reminder>"}];

	function attachmentRecord(attachment: Record<string, unknown>) {
		return {type: "attachment", ...baseFields, attachment, rendered};
	}

	it("parses an api-request whose auto_mode carries hard_deny rules", () => {
		const fixture = jsonlRecordFixtures["api-request"];
		const [safeguard] = fixture.params.safeguards;
		const classifierContext = safeguard!.classifier_context;
		const record = {
			...fixture,
			params: {
				...fixture.params,
				safeguards: [
					{
						...safeguard!,
						classifier_context: {
							...classifierContext,
							auto_mode: {
								...classifierContext.auto_mode,
								hard_deny: ["$defaults", "Bash(git push --force:*)"],
							},
						},
					},
				],
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses an api-request whose classifier artifacts.by_slug is keyed by artifact id", () => {
		const fixture = jsonlRecordFixtures["api-request"];
		const [safeguard] = fixture.params.safeguards;
		const classifierContext = safeguard!.classifier_context;
		const record = {
			...fixture,
			params: {
				...fixture.params,
				safeguards: [
					{
						...safeguard!,
						classifier_context: {
							...classifierContext,
							artifacts: {
								...classifierContext.artifacts,
								by_slug: {
									"5bafe76e-893d-4863-98b2-cb9ad1c3bded": {
										share: {
											mode: "owner",
											is_shared_live: false,
											role: "owner",
											probed: true,
											probe_current_account: true,
											type_lock: false,
											live_paths: [],
											capabilities: {db: {}},
											grant_observed: true,
										},
									},
								},
							},
						},
					},
				],
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses classifier artifacts attested as a first-party type with no share probe", () => {
		const fixture = jsonlRecordFixtures["api-request"];
		const [safeguard] = fixture.params.safeguards;
		const classifierContext = safeguard!.classifier_context;
		const record = {
			...fixture,
			params: {
				...fixture.params,
				safeguards: [
					{
						...safeguard!,
						classifier_context: {
							...classifierContext,
							artifacts: {
								...classifierContext.artifacts,
								by_slug: {
									"7dfcf06e-b15d-4b48-aeaf-1d6edfc6d7a0": {attested: "first_party_type"},
								},
							},
						},
					},
				],
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses classifier artifacts with a failed share probe, an unprobed published share, by_path, and last_publish", () => {
		const fixture = jsonlRecordFixtures["api-request"];
		const [safeguard] = fixture.params.safeguards;
		const classifierContext = safeguard!.classifier_context;
		const record = {
			...fixture,
			params: {
				...fixture.params,
				safeguards: [
					{
						...safeguard!,
						classifier_context: {
							...classifierContext,
							artifacts: {
								...classifierContext.artifacts,
								by_slug: {
									"5bafe76e-893d-4863-98b2-cb9ad1c3bded": {
										share: {
											mode: "owner",
											is_shared_live: false,
											role: "owner",
											probe_failed: true,
											probed: true,
											probe_current_account: true,
											type_lock: false,
											live_paths: [],
											grant_observed: true,
										},
									},
									"612a47bc-b61b-41d7-8401-6dd996c5af14": {
										share: {
											mode: "owner",
											is_shared_live: false,
											probed: false,
											probe_current_account: true,
											live_paths: [],
											capabilities: {db: {}},
											grant_observed: true,
										},
										published_env: "prod",
									},
								},
								by_path: {
									"/tmp/alice/scratchpad/gallery/review.html": {
										slug: "612a47bc-b61b-41d7-8401-6dd996c5af14",
									},
								},
								last_publish: {slug: "612a47bc-b61b-41d7-8401-6dd996c5af14", env: "prod"},
							},
						},
					},
				],
			},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses summarized-turn and superseded uuids on user and assistant records", () => {
		const records = [
			{...jsonlRecordFixtures.user, summarizedTurnPromptUuids: ["prompt-alice-1", "prompt-alice-2"]},
			{...jsonlRecordFixtures.assistant, supersedesUuids: ["message-alice-99"]},
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses model_refusal_fallback system records, with and without a request id", () => {
		const records = [
			{
				type: "system",
				...baseFields,
				subtype: "model_refusal_fallback",
				content: "",
				level: "info",
				originalModel: "claude-opus-5-5",
				fallbackModel: "claude-sonnet-5-5",
				trigger: "refusal",
				direction: "retry",
				scope: "session",
				requestId: "req_011CgFaXu4vBJjAD4zM5mZ3W",
				apiRefusalCategory: "cyber",
				apiRefusalExplanation: "This request triggered restrictions on violative cyber content.",
				refusedUserMessageUuid: "06ac5d00-1f7a-4e96-a16b-462c368c8aeb",
				retractedMessageUuids: ["message-alice-101"],
				isMeta: false,
			},
			{
				type: "system",
				...baseFields,
				subtype: "model_refusal_fallback",
				content: "",
				level: "info",
				fallbackModel: "claude-opus-5-5",
				direction: "revert",
				scope: "local",
				requestId: null,
				apiRefusalCategory: null,
				apiRefusalExplanation: null,
				refusedUserMessageUuid: null,
				isMeta: false,
			},
			{
				type: "system",
				...baseFields,
				subtype: "model_refusal_fallback",
				content: "",
				level: "info",
				direction: "sticky",
				isMeta: false,
			},
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("rejects an unknown model_refusal_fallback direction", () => {
		const record = {type: "system", ...baseFields, subtype: "model_refusal_fallback", direction: "sideways"};

		expect(JsonlRecordSchema.safeParse(record).success).toBe(false);
	});

	it("parses api-request-blob clear_at and deferred_tools_delta loadedNames", () => {
		const records = [
			{
				...jsonlRecordFixtures["api-request-blob"],
				message: {...jsonlRecordFixtures["api-request-blob"].message, clear_at: "next_user_message"},
			},
			attachmentRecord({type: "deferred_tools_delta", loadedNames: ["mcp__docs__guide"]}),
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});

	it("parses classifier-sourced permission decisions", () => {
		const record = {
			type: "user",
			...baseFields,
			message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_1", content: "ok"}]},
			permissionDecision: {decision: "accept", source: "classifier", reasonType: "classifier"},
		};

		expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
	});

	it("parses token_usage attachments and rejects fractional counts", () => {
		const record = attachmentRecord({type: "token_usage", used: 120000, total: 1000000, remaining: 880000});

		expect({
			parsed: JsonlRecordSchema.parse(record),
			fractional: JsonlRecordSchema.safeParse(
				attachmentRecord({type: "token_usage", used: 1.5, total: 1000000, remaining: 880000}),
			).success,
		}).toStrictEqual({parsed: record, fractional: false});
	});

	it("parses file-history-delta records, including a backup of a file that did not exist yet", () => {
		const records = [
			jsonlRecordFixtures["file-history-delta"],
			{
				...jsonlRecordFixtures["file-history-delta"],
				backup: {
					backupFileName: null,
					version: 1,
					backupTime: "2000-01-01T00:00:00.000Z",
					realParentDir: "/tmp/test/alice-project/src",
				},
			},
		];

		expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
	});
});

describe("SessionRegistryFileSchema", () => {
	it("parses a registry file whose bridge session was cleared to null", () => {
		const entry = {
			pid: 64835,
			sessionId: "s1",
			cwd: "/tmp/project",
			startedAt: 1790602944268,
			procStart: "Sat Oct 17 12:00:00 2026",
			version: "2.1.300",
			peerProtocol: 1,
			peerFeatures: ["messaging"],
			kind: "interactive",
			entrypoint: "cli",
			pidDomain: "host",
			messagingSocketPath: "/tmp/claude.sock",
			name: "session",
			nameSource: "auto",
			nameSince: 1790602944268,
			status: "idle",
			updatedAt: 1790602944268,
			statusUpdatedAt: 1790602944268,
			bridgeSessionId: null,
		};

		expect(SessionRegistryFileSchema.parse(entry)).toStrictEqual(entry);
	});

	it("parses a registry file without pidDomain carrying a job id and former names", () => {
		const entry = {
			pid: 64836,
			sessionId: "s2",
			cwd: "/tmp/project",
			startedAt: 1790602944268,
			procStart: "Sat Oct 17 12:00:00 2026",
			version: "2.1.310",
			kind: "bg",
			entrypoint: "cli",
			jobId: "221f2efe",
			name: "renamed-session",
			formerNames: [{name: "first-name", until: 1790602999999}],
			status: "busy",
			updatedAt: 1790602944268,
			statusUpdatedAt: 1790602944268,
		};

		expect(SessionRegistryFileSchema.parse(entry)).toStrictEqual(entry);
	});
});

describe("SessionRegistryFileSchema against disk", () => {
	const sessionsDir = join(homedir(), ".claude", "sessions");

	it("validates every <pid>.json registry file on disk", async () => {
		const io = diskRegistryIo(sessionsDir);
		try {
			io.readdir();
		} catch {
			return;
		}

		const failures = await scanRegistryDir(io, SessionRegistryFileSchema);
		expect(failures).toStrictEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Per-tool input schemas (Level 3)
// ---------------------------------------------------------------------------

describe("Per-tool input schemas", () => {
	describe("BashInputSchema", () => {
		it("accepts required command field", () => {
			expect(BashInputSchema.safeParse({command: "ls -la"}).success).toBe(true);
		});

		it("accepts all optional fields", () => {
			const input = {
				command: "npm test",
				description: "Run tests",
				timeout: 30000,
				run_in_background: false,
				dangerouslyDisableSandbox: true,
			};
			expect(BashInputSchema.safeParse(input).success).toBe(true);
		});

		it("rejects unknown fields", () => {
			const result = BashInputSchema.safeParse({
				command: "ls",
				extraField: true,
			});
			expect(result.success).toBe(false);
		});

		it("rejects missing command", () => {
			const result = BashInputSchema.safeParse({description: "oops"});
			expect(result.success).toBe(false);
		});
	});

	describe("ReadInputSchema", () => {
		it("accepts required file_path", () => {
			expect(ReadInputSchema.safeParse({file_path: "/foo.ts"}).success).toBe(true);
		});

		it("accepts optional offset, limit, pages", () => {
			const input = {
				file_path: "/foo.ts",
				offset: 10,
				limit: 50,
				pages: "1-5",
			};
			expect(ReadInputSchema.safeParse(input).success).toBe(true);
		});

		it("rejects unknown fields", () => {
			const result = ReadInputSchema.safeParse({
				file_path: "/foo.ts",
				unknown: 1,
			});
			expect(result.success).toBe(false);
		});
	});

	describe("EditInputSchema", () => {
		it("accepts required fields", () => {
			const input = {file_path: "/foo.ts", old_string: "a", new_string: "b"};
			expect(EditInputSchema.safeParse(input).success).toBe(true);
		});

		it("accepts replace_all", () => {
			const input = {
				file_path: "/foo.ts",
				old_string: "a",
				new_string: "b",
				replace_all: true,
			};
			expect(EditInputSchema.safeParse(input).success).toBe(true);
		});
	});

	describe("WriteInputSchema", () => {
		it("accepts required fields", () => {
			const input = {file_path: "/foo.ts", content: "hello"};
			expect(WriteInputSchema.safeParse(input).success).toBe(true);
		});

		it("accepts legacy path/data fields", () => {
			const input = {path: "/foo.ts", data: "hello"};
			expect(WriteInputSchema.safeParse(input).success).toBe(true);
		});

		it("accepts path/content fields from historical transcripts", () => {
			const input = {path: "/foo.ts", content: "hello"};
			expect(WriteInputSchema.safeParse(input).success).toBe(true);
		});

		it("rejects incomplete write fields", () => {
			expect(WriteInputSchema.safeParse({file_path: "/foo.ts"}).success).toBe(false);
			expect(WriteInputSchema.safeParse({path: "/foo.ts"}).success).toBe(false);
		});
	});

	describe("GlobInputSchema", () => {
		it("accepts pattern with optional path", () => {
			expect(GlobInputSchema.safeParse({pattern: "**/*.ts"}).success).toBe(true);
			expect(GlobInputSchema.safeParse({pattern: "**/*.ts", path: "/src"}).success).toBe(true);
		});
	});

	describe("GrepInputSchema", () => {
		it("accepts pattern with all optional fields", () => {
			const input = {
				pattern: "foo",
				path: "/src",
				glob: "*.ts",
				type: "ts",
				"-i": true,
				output_mode: "content",
				"-A": 3,
				"-B": 3,
				"-C": 5,
				"-n": true,
				head_limit: 100,
				offset: 10,
				multiline: false,
				context: 2,
			};
			expect(GrepInputSchema.safeParse(input).success).toBe(true);
		});
	});

	describe("AgentInputSchema", () => {
		it("accepts required prompt", () => {
			expect(AgentInputSchema.safeParse({prompt: "Do something"}).success).toBe(true);
		});

		it("accepts all optional fields", () => {
			const input = {
				prompt: "Do something",
				description: "Test agent",
				subagent_type: "Code",
				isolation: "full",
				mode: "plan",
				model: "sonnet",
				effort: "high",
				name: "my-agent",
				run_in_background: true,
				team_name: "alpha",
			};
			expect(AgentInputSchema.safeParse(input).success).toBe(true);
		});

		it("accepts run_in_background as the stringified booleans the model sometimes sends", () => {
			expect(AgentInputSchema.safeParse({prompt: "Do something", run_in_background: "true"}).success).toBe(true);
			expect(AgentInputSchema.safeParse({prompt: "Do something", run_in_background: "false"}).success).toBe(true);
		});

		it("rejects run_in_background strings other than true or false", () => {
			expect(AgentInputSchema.safeParse({prompt: "Do something", run_in_background: "yes"}).success).toBe(false);
		});
	});

	describe("MonitorInputSchema", () => {
		const schema = toolInputSchemas.Monitor;

		it("accepts persistent as a stringified boolean", () => {
			expect(schema.safeParse({command: "tail -f log", persistent: "false"}).success).toBe(true);
			expect(schema.safeParse({command: "tail -f log", persistent: "true"}).success).toBe(true);
		});

		it("rejects persistent strings other than true or false", () => {
			expect(schema.safeParse({command: "tail -f log", persistent: "no"}).success).toBe(false);
		});
	});

	describe("SendMessageInputSchema", () => {
		const schema = toolInputSchemas.SendMessage;

		it("accepts recipient_kind name and agent", () => {
			expect(schema.safeParse({to: "slotter", recipient_kind: "name", summary: "s", message: "m"}).success).toBe(
				true,
			);
			expect(schema.safeParse({to: "a1b2c3", recipient_kind: "agent", message: "m"}).success).toBe(true);
		});

		it("rejects an unknown recipient_kind", () => {
			expect(schema.safeParse({to: "x", recipient_kind: "team", message: "m"}).success).toBe(false);
		});

		it("accepts notify_when_idle", () => {
			expect(schema.safeParse({to: "other-session", notify_when_idle: true}).success).toBe(true);
		});
	});

	describe("WebSearchInputSchema", () => {
		const schema = toolInputSchemas.WebSearch;

		it("accepts mode standard and extended", () => {
			expect(schema.safeParse({query: "factorio fuel_category", mode: "standard"}).success).toBe(true);
			expect(schema.safeParse({query: "factorio fuel_category", mode: "extended"}).success).toBe(true);
		});

		it("rejects an unknown mode", () => {
			expect(schema.safeParse({query: "factorio fuel_category", mode: "deep"}).success).toBe(false);
		});
	});

	describe("ArtifactInputSchema capabilities", () => {
		it("accepts db access rules and the user capability as published on disk", () => {
			const input = {
				file_path: "/tmp/tagger.html",
				capabilities: {db: {rules: [{path: "", read: "view", write: "owner"}]}, user: {}},
				description: "Pick tags to apply or remove.",
			};
			expect(ArtifactInputSchema.safeParse(input).success).toBe(true);
		});

		it("accepts a write-only rule and user profile scopes", () => {
			const input = {
				file_path: "/tmp/votes.html",
				capabilities: {
					db: {rules: [{path: "votes/{self}", write: "interact"}]},
					user: {scopes: ["profile", "email"]},
				},
			};
			expect(ArtifactInputSchema.safeParse(input).success).toBe(true);
		});

		it("rejects an unknown access level", () => {
			const input = {file_path: "/tmp/x.html", capabilities: {db: {rules: [{path: "", read: "everyone"}]}}};
			expect(ArtifactInputSchema.safeParse(input).success).toBe(false);
		});

		it("rejects an unknown user scope", () => {
			const input = {file_path: "/tmp/x.html", capabilities: {user: {scopes: ["phone"]}}};
			expect(ArtifactInputSchema.safeParse(input).success).toBe(false);
		});
	});

	describe("task tool schemas", () => {
		it("accepts TaskCreate input without a subject", () => {
			const schema = toolInputSchemas.TaskCreate;
			const result = schema.safeParse({
				description: "Create an example task",
				activeForm: "Creating an example task",
			});
			expect(result.success).toBe(true);
		});

		it("accepts TaskGet input with id", () => {
			const schema = toolInputSchemas.TaskGet;
			const result = schema.safeParse({id: "task-100"});
			expect(result.success).toBe(true);
		});
	});

	it("registry covers all known tools", () => {
		const expectedTools = [
			"Bash",
			"Read",
			"Edit",
			"MultiEdit",
			"Write",
			"Glob",
			"Grep",
			"Agent",
			"WebFetch",
			"Skill",
			"TaskCreate",
			"TaskUpdate",
			"TaskGet",
			"TaskList",
			"AskUserQuestion",
			"ExitPlanMode",
			"ToolSearch",
		];
		expect(expectedTools.filter((tool) => toolInputSchemaByName.get(tool) === undefined)).toStrictEqual([]);
	});

	it("looks up a schema by an unvalidated tool name", () => {
		expect({
			known: toolInputSchemaByName.get("Bash"),
			unknown: toolInputSchemaByName.get("NoSuchTool"),
			inherited: toolInputSchemaByName.get("constructor"),
		}).toStrictEqual({known: toolInputSchemas.Bash, unknown: undefined, inherited: undefined});
	});
});

// ---------------------------------------------------------------------------
// ContentBlockSchema superRefine validates tool inputs
// ---------------------------------------------------------------------------

describe("ContentBlockSchema tool input validation", () => {
	it("validates known tool input via superRefine", () => {
		const block = {
			type: "tool_use",
			id: "tu_1",
			name: "Read",
			input: {file_path: "/foo.ts"},
		};
		const result = ContentBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it("accepts unknown tool names without validation", () => {
		const block = {
			type: "tool_use",
			id: "tu_1",
			name: "NonExistentTool",
			input: {},
		};
		const result = ContentBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it("rejects invalid input for known tools", () => {
		const block = {
			type: "tool_use",
			id: "tu_1",
			name: "Bash",
			input: {notACommand: "oops"},
		};
		const result = ContentBlockSchema.safeParse(block);
		expect(result.success).toBe(false);
	});

	it("accepts TaskCreate metadata objects", () => {
		const block = {
			type: "tool_use",
			id: "tu_1",
			name: "TaskCreate",
			input: {
				subject: "Ship the feature",
				metadata: {
					commit_sha: "769a03b2",
					test_pass_rate: "100%",
				},
			},
		};
		const result = ContentBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it("accepts TaskCreate inputs without subjects", () => {
		const block = {
			type: "tool_use",
			id: "tu_1",
			name: "TaskCreate",
			input: {
				description: "Create the next task from context",
			},
		};
		const result = ContentBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it("accepts TaskUpdate metadata objects and strings", () => {
		const objectMetadataBlock = {
			type: "tool_use",
			id: "tu_1",
			name: "TaskUpdate",
			input: {
				taskId: "1",
				status: "completed",
				metadata: {
					commit_sha: "dd9b3c9f7514fdec89f64be11f1a254c92d11c42",
					tests_added: 11,
				},
			},
		};
		const stringMetadataBlock = {
			type: "tool_use",
			id: "tu_2",
			name: "TaskUpdate",
			input: {
				taskId: "1",
				status: "completed",
				metadata: '{"precommit_checks":"15/15 passed"}',
			},
		};
		expect(ContentBlockSchema.safeParse(objectMetadataBlock).success).toBe(true);
		expect(ContentBlockSchema.safeParse(stringMetadataBlock).success).toBe(true);
	});

	it("accepts historical TaskUpdate id input", () => {
		const block = {
			type: "tool_use",
			id: "tu_1",
			name: "TaskUpdate",
			input: {
				id: 6,
				status: "completed",
				addBlocks: ["100", "200"],
			},
		};

		expect(ContentBlockSchema.parse(block)).toStrictEqual(block);
	});

	it("accepts TaskGet id input", () => {
		const block = {
			type: "tool_use",
			id: "tool-task-get-100",
			name: "TaskGet",
			input: {
				id: "100",
			},
		};
		expect(ContentBlockSchema.safeParse(block).success).toBe(true);
	});

	it("rejects extra input fields for known tools", () => {
		const block = {
			type: "tool_use",
			id: "tu_1",
			name: "Read",
			input: {file_path: "/foo.ts", extraField: "nope"},
		};
		const result = ContentBlockSchema.safeParse(block);
		expect(result.success).toBe(false);
	});

	it("allows MCP tools without strict input validation", () => {
		const block = {
			type: "tool_use",
			id: "tu_1",
			name: "mcp__plugin_github_github__list_issues",
			input: {owner: "foo", repo: "bar", anythingGoes: true},
		};
		const result = ContentBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});

	it("does not validate non-tool_use blocks", () => {
		const block = {type: "text", text: "hello"};
		const result = ContentBlockSchema.safeParse(block);
		expect(result.success).toBe(true);
	});
});

describe("ClaudeSettingsSchema fast mode", () => {
	it("accepts fastMode and fastModePerSessionOptIn", () => {
		expect(ClaudeSettingsSchema.parse({fastMode: true, fastModePerSessionOptIn: true})).toStrictEqual({
			fastMode: true,
			fastModePerSessionOptIn: true,
		});
	});
});
