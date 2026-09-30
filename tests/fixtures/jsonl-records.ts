import type {z} from "zod";
import type {JsonlRecordSchema} from "../../src/lib/schemas";

type JsonlRecord = z.infer<typeof JsonlRecordSchema>;
type JsonlRecordFixtures = {
	[RecordType in JsonlRecord["type"]]: Extract<JsonlRecord, {type: RecordType}>;
};

const baseRecordFields = {
	uuid: "message-alice-100",
	timestamp: "2000-01-01T00:00:00.000Z",
	sessionId: "session-alice-100",
	parentUuid: null,
	isSidechain: false,
	userType: "external",
	cwd: "/tmp/test/alice-project",
	gitBranch: "test/alice-branch",
	version: "1.0.0-test",
	entrypoint: "cli",
};

export const jsonlRecordFixtures = {
	user: {
		type: "user",
		...baseRecordFields,
		message: {role: "user", content: "Inspect the example project."},
	},
	assistant: {
		type: "assistant",
		...baseRecordFields,
		requestId: "request-alice-100",
		message: {
			role: "assistant",
			model: "test-model",
			content: [{type: "text", text: "I will inspect the example project."}],
		},
	},
	"custom-title": {
		type: "custom-title",
		customTitle: "Alice's Example Session",
		sessionId: "session-alice-100",
	},
	"file-history-snapshot": {
		type: "file-history-snapshot",
		messageId: "message-alice-100",
		snapshot: {
			messageId: "message-alice-100",
			timestamp: "2000-01-01T00:00:00.000Z",
			trackedFileBackups: {},
		},
	},
	"fork-context-ref": {
		type: "fork-context-ref",
		agentId: "agent-alice-100",
		parentSessionId: "session-alice-100",
		parentLastUuid: "message-alice-100",
		contextLength: 100,
	},
	attachment: {
		type: "attachment",
		...baseRecordFields,
		attachment: {type: "plan_mode", planFilePath: "/tmp/test/alice-plan.md"},
	},
	progress: {
		type: "progress",
		...baseRecordFields,
		data: {type: "hook_progress", message: "Example progress"},
	},
	system: {
		type: "system",
		...baseRecordFields,
		subtype: "turn_duration",
		durationMs: 1000,
	},
	"ai-title": {
		type: "ai-title",
		aiTitle: "Alice's Generated Title",
		sessionId: "session-alice-100",
	},
	"last-prompt": {
		type: "last-prompt",
		lastPrompt: "Inspect the example project.",
		sessionId: "session-alice-100",
	},
	"queue-operation": {
		type: "queue-operation",
		operation: "enqueue",
		timestamp: "2000-01-01T00:00:00.000Z",
		sessionId: "session-alice-100",
		content: "Run the example task.",
	},
	"agent-name": {
		type: "agent-name",
		agentName: "Alice",
		sessionId: "session-alice-100",
	},
	"agent-setting": {
		type: "agent-setting",
		agentSetting: "example-setting",
		sessionId: "session-alice-100",
	},
	"agent-color": {
		type: "agent-color",
		agentColor: "blue",
		sessionId: "session-alice-100",
	},
	"permission-mode": {
		type: "permission-mode",
		permissionMode: "default",
		sessionId: "session-alice-100",
	},
	"worktree-state": {
		type: "worktree-state",
		sessionId: "session-alice-100",
		worktreeSession: {
			originalCwd: "/tmp/test/alice-project",
			worktreePath: "/tmp/test/alice-worktree",
			worktreeName: "alice-worktree",
			worktreeBranch: "test/alice-worktree",
			sessionId: "session-alice-100",
		},
	},
	relocated: {
		type: "relocated",
		sessionId: "session-alice-100",
		relocatedCwd: "/tmp/test/alice-worktree",
	},
	"pr-link": {
		type: "pr-link",
		prUrl: "https://example.com/alice/repository/pull/100",
		prNumber: 100,
		prRepository: "alice/repository",
		sessionId: "session-alice-100",
		timestamp: "2000-01-01T00:00:00.000Z",
	},
	mode: {
		type: "mode",
		mode: "default",
		sessionId: "session-alice-100",
	},
	"atis-latch": {
		type: "atis-latch",
		atis: "v1.test-latch",
		sessionId: "session-alice-100",
	},
	"bridge-session": {
		type: "bridge-session",
		sessionId: "session-alice-100",
		bridgeSessionId: "cse_alice_100",
		lastSequenceNum: 100,
	},
	"cost-state": {
		type: "cost-state",
		sessionId: "session-alice-100",
		totalCostUSD: 1,
		modelUsage: {"claude-test": {inputTokens: 100, outputTokens: 100, costUSD: 1}},
	},
	"frame-link": {
		type: "frame-link",
		sessionId: "session-alice-100",
		path: "/tmp/test/alice-page.html",
		frameUrl: "https://example.com/artifact/alice-100",
		title: "Alice page",
		artifactCount: 1,
		timestamp: "2000-01-01T00:00:00.000Z",
	},
	"artifact-comment-monitor": {
		type: "artifact-comment-monitor",
		v: 1,
		sessionId: "session-alice-100",
		artifacts: {
			"https://example.com/artifact/alice-100": {state: "armed", title: "Alice page"},
		},
	},
	"artifact-autoreact-ledger": {
		type: "artifact-autoreact-ledger",
		v: 1,
		sessionId: "session-alice-100",
		artifacts: {"https://example.com/artifact/alice-100": {savedAt: 1, stampHighWater: null}},
	},
} satisfies JsonlRecordFixtures;
