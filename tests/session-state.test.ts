import {describe, expect, it} from "vite-plus/test";

import {KNOWN_HOOK_EVENTS} from "../src/lib/hook-events";
import type {HookEvent} from "../src/lib/hook-events";
import {
	STATE_RANK,
	compareByStableCreation,
	compareByUrgency,
	displayState,
	resolveMainState,
	sessionProcessLive,
	resolveSessionBucket,
	stateForEvent,
	waitHeat,
	type ActivityState,
	type DisplayState,
	type SessionBucketResolution,
} from "../src/lib/session-state";
import {isAwaitingPermission} from "../src/lib/permission-card";

const ACTIVITY_STATES = ["idle", "working", "waiting", "unknown"] satisfies ActivityState[];
const DISPLAY_STATES = [...ACTIVITY_STATES, "review"] satisfies DisplayState[];

const BASE_EVENT = {
	session_id: "session-test-100",
	transcript_path: "/tmp/test/session-test-100.jsonl",
	cwd: "/tmp/test/project",
} as const;

interface StateCase {
	name: string;
	event: HookEvent;
	expected: ActivityState | null;
}

const STATE_CASES = [
	{
		name: "SessionStart carries no state",
		event: {...BASE_EVENT, hook_event_name: "SessionStart", source: "startup"},
		expected: null,
	},
	{
		name: "SessionEnd is idle",
		event: {...BASE_EVENT, hook_event_name: "SessionEnd"},
		expected: "idle",
	},
	{
		name: "Stop is idle",
		event: {...BASE_EVENT, hook_event_name: "Stop"},
		expected: "idle",
	},
	{
		name: "SubagentStart carries no state",
		event: {...BASE_EVENT, hook_event_name: "SubagentStart"},
		expected: null,
	},
	{
		name: "SubagentStop carries no state",
		event: {...BASE_EVENT, hook_event_name: "SubagentStop"},
		expected: null,
	},
	{
		name: "UserPromptSubmit is working",
		event: {...BASE_EVENT, hook_event_name: "UserPromptSubmit", prompt: "Test prompt"},
		expected: "working",
	},
	{
		name: "Notification carries no state",
		event: {...BASE_EVENT, hook_event_name: "Notification", message: "Test notification"},
		expected: null,
	},
	{
		name: "Notification for a CLI elicitation form dialog is waiting",
		event: {
			...BASE_EVENT,
			hook_event_name: "Notification",
			message: "An MCP server needs your input",
			notification_type: "elicitation_dialog",
		},
		expected: "waiting",
	},
	{
		name: "Notification for a CLI elicitation URL dialog is waiting",
		event: {
			...BASE_EVENT,
			hook_event_name: "Notification",
			message: "An MCP server needs your input",
			notification_type: "elicitation_url_dialog",
		},
		expected: "waiting",
	},
	{
		name: "Notification for an idle prompt carries no state",
		event: {...BASE_EVENT, hook_event_name: "Notification", message: "Waiting", notification_type: "idle_prompt"},
		expected: null,
	},
	{
		name: "PermissionRequest carries no state",
		event: {
			...BASE_EVENT,
			hook_event_name: "PermissionRequest",
			tool_name: "Bash",
			tool_input: {command: "rm -rf dist"},
		},
		expected: null,
	},
	{
		name: "manual PreCompact is working",
		event: {...BASE_EVENT, hook_event_name: "PreCompact", trigger: "manual"},
		expected: "working",
	},
	{
		name: "automatic PreCompact carries no state",
		event: {...BASE_EVENT, hook_event_name: "PreCompact", trigger: "auto"},
		expected: null,
	},
	{
		name: "PreCompact without trigger carries no state",
		event: {...BASE_EVENT, hook_event_name: "PreCompact"},
		expected: null,
	},
	{
		name: "manual PostCompact is idle",
		event: {...BASE_EVENT, hook_event_name: "PostCompact", reason: "manual"},
		expected: "idle",
	},
	{
		name: "automatic PostCompact carries no state",
		event: {...BASE_EVENT, hook_event_name: "PostCompact", reason: "auto"},
		expected: null,
	},
	{
		name: "PostCompact without reason carries no state",
		event: {...BASE_EVENT, hook_event_name: "PostCompact"},
		expected: null,
	},
	{
		name: "AskUserQuestion PreToolUse is waiting",
		event: {
			...BASE_EVENT,
			hook_event_name: "PreToolUse",
			tool_name: "AskUserQuestion",
			tool_input: {question: "Test question?"},
		},
		expected: "waiting",
	},
	{
		name: "ExitPlanMode PreToolUse is waiting",
		event: {
			...BASE_EVENT,
			hook_event_name: "PreToolUse",
			tool_name: "ExitPlanMode",
			tool_input: {plan: "Test plan"},
		},
		expected: "waiting",
	},
	{
		name: "other PreToolUse is working",
		event: {
			...BASE_EVENT,
			hook_event_name: "PreToolUse",
			tool_name: "Bash",
			tool_input: {command: "true"},
		},
		expected: "working",
	},
	{
		name: "PostToolUse is working",
		event: {
			...BASE_EVENT,
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			tool_input: {command: "true"},
		},
		expected: "working",
	},
	{
		name: "PostToolUseFailure is working",
		event: {
			...BASE_EVENT,
			hook_event_name: "PostToolUseFailure",
			tool_name: "Bash",
			tool_input: {command: "false"},
			error: "Test failure",
		},
		expected: "working",
	},
	{
		name: "TaskCreated carries no state",
		event: {...BASE_EVENT, hook_event_name: "TaskCreated"},
		expected: null,
	},
	{
		name: "TaskCompleted carries no state",
		event: {...BASE_EVENT, hook_event_name: "TaskCompleted"},
		expected: null,
	},
	{
		name: "WorktreeCreate carries no state",
		event: {...BASE_EVENT, hook_event_name: "WorktreeCreate"},
		expected: null,
	},
	{
		name: "WorktreeRemove carries no state",
		event: {...BASE_EVENT, hook_event_name: "WorktreeRemove"},
		expected: null,
	},
	{
		name: "CwdChanged carries no state",
		event: {
			...BASE_EVENT,
			hook_event_name: "CwdChanged",
			old_cwd: "/tmp/test/old-project",
			new_cwd: "/tmp/test/new-project",
		},
		expected: null,
	},
	{
		name: "InstructionsLoaded carries no state",
		event: {
			...BASE_EVENT,
			hook_event_name: "InstructionsLoaded",
			file_path: "/tmp/test/project/CLAUDE.md",
		},
		expected: null,
	},
	{
		name: "ConfigChange carries no state",
		event: {
			...BASE_EVENT,
			hook_event_name: "ConfigChange",
			config_source: "project_settings",
		},
		expected: null,
	},
	{
		name: "MessageDisplay is working",
		event: {...BASE_EVENT, hook_event_name: "MessageDisplay", message: "Test response"},
		expected: "working",
	},
	{
		name: "StopFailure ends the turn idle",
		event: {...BASE_EVENT, hook_event_name: "StopFailure", error: "rate_limit"},
		expected: "idle",
	},
	{
		name: "PermissionDenied carries no state",
		event: {
			...BASE_EVENT,
			hook_event_name: "PermissionDenied",
			tool_name: "Bash",
			tool_input: {command: "rm -rf /tmp/test/build"},
			reason: "[Irreversible Local Destruction]",
		},
		expected: null,
	},
	{
		name: "PostModelSwitch carries no state",
		event: {
			...BASE_EVENT,
			hook_event_name: "PostModelSwitch",
			from_model: "claude-sonnet-5-5",
			to_model: "claude-haiku-5-5",
			requested_model: "haiku",
			source: "command",
			context_tokens: 0,
			prompt_cache_warm: false,
			cache_ttl: "5m",
			estimated_cache_write_usd: 0,
			pricing: "catalog",
		},
		expected: null,
	},
	{
		name: "Elicitation is waiting",
		event: {...BASE_EVENT, hook_event_name: "Elicitation", mcp_server_name: "server-test", message: "Sign in"},
		expected: "waiting",
	},
	{
		name: "ElicitationResult is working",
		event: {...BASE_EVENT, hook_event_name: "ElicitationResult", mcp_server_name: "server-test", action: "accept"},
		expected: "working",
	},
] satisfies StateCase[];

describe("stateForEvent", () => {
	it("exports the activity and display state contracts", () => {
		expect({activity: ACTIVITY_STATES, display: DISPLAY_STATES}).toStrictEqual({
			activity: ["idle", "working", "waiting", "unknown"],
			display: ["idle", "working", "waiting", "unknown", "review"],
		});
	});

	it("covers every known hook event", () => {
		expect(new Set(STATE_CASES.map(({event}) => event.hook_event_name))).toStrictEqual(new Set(KNOWN_HOOK_EVENTS));
	});

	it.each(STATE_CASES)("maps $name", ({event, expected}) => {
		expect(stateForEvent(event)).toBe(expected);
	});
});

describe("compareByUrgency", () => {
	it("defines the complete urgency rank", () => {
		expect(STATE_RANK).toStrictEqual({
			waiting: 0,
			review: 1,
			working: 2,
			idle: 3,
			unknown: 4,
		});
	});

	it("sorts by state rank before recency and by newest activity within a state", () => {
		const sessions = [
			{id: "unknown-newest", state: "unknown", lastModified: 9_000},
			{id: "waiting-older", state: "waiting", lastModified: 1_000},
			{id: "working-newer", state: "working", lastModified: 8_000},
			{id: "review", state: "review", lastModified: 4_000},
			{id: "idle", state: "idle", lastModified: 5_000},
			{id: "waiting-newer", state: "waiting", lastModified: 3_000},
			{id: "working-older", state: "working", lastModified: 2_000},
		] satisfies Array<{id: string; state: DisplayState; lastModified: number}>;

		expect(sessions.toSorted(compareByUrgency).map(({id}) => id)).toStrictEqual([
			"waiting-newer",
			"waiting-older",
			"review",
			"working-newer",
			"working-older",
			"idle",
			"unknown-newest",
		]);
	});
});

describe("compareByStableCreation", () => {
	it("sorts by creation time with a session-id tiebreak and ignores activity", () => {
		const sessions = [
			{sessionId: "session-c", createdAt: 2_000, lastModified: 9_000},
			{sessionId: "session-b", createdAt: 1_000, lastModified: 1_000},
			{sessionId: "session-a", createdAt: 1_000, lastModified: 8_000},
		];

		expect(sessions.toSorted(compareByStableCreation).map(({sessionId}) => sessionId)).toStrictEqual([
			"session-a",
			"session-b",
			"session-c",
		]);
	});
});

describe("displayState", () => {
	it("turns unseen idle work into review", () => {
		expect(displayState("idle", true)).toBe("review");
	});

	it("leaves every activity state unchanged without unseen work", () => {
		expect(ACTIVITY_STATES.map((state) => displayState(state, false))).toStrictEqual([
			"idle",
			"working",
			"waiting",
			"unknown",
		]);
	});

	it("does not replace active states when unseen work is latched", () => {
		expect(
			ACTIVITY_STATES.filter((state) => state !== "idle").map((state) => displayState(state, true)),
		).toStrictEqual(["working", "waiting", "unknown"]);
	});
});

describe("waitHeat", () => {
	const now = Date.parse("2000-01-01T00:30:00.000Z");

	it("is warm at the exact ten-minute boundary", () => {
		expect(waitHeat("waiting", "2000-01-01T00:20:00.000Z", now)).toBe("warm");
	});

	it("is hot at the exact thirty-minute boundary", () => {
		expect(waitHeat("waiting", "2000-01-01T00:00:00.000Z", now)).toBe("hot");
	});

	it("has no heat without a blocked-since timestamp", () => {
		expect(waitHeat("waiting", null, now)).toBe("");
	});

	it("does not encode age for non-waiting states", () => {
		expect(
			DISPLAY_STATES.filter((state) => state !== "waiting").map((state) =>
				waitHeat(state, "1999-12-31T00:00:00.000Z", now),
			),
		).toStrictEqual(["", "", "", ""]);
	});
});

describe("resolveSessionBucket for a session blocked on a permission prompt", () => {
	const NOW = 946_598_400_000;
	const PERMISSION_NOTIFICATION = {
		id: "notification-test-100",
		sessionId: "session-test-100",
		notificationType: "permission_prompt",
		message: "Claude needs your permission to use Bash",
	};
	const PENDING_BASH = {
		type: "assistant",
		message: {content: [{type: "tool_use", id: "tool-test-100", name: "Bash", input: {command: "true"}}]},
	};
	const BASH_RESULT = {
		type: "user",
		message: {content: [{type: "tool_result", tool_use_id: "tool-test-100", content: "ok"}]},
	};

	function bucketFor(records: readonly unknown[]): SessionBucketResolution {
		return resolveSessionBucket({
			mainState: "ended",
			pendingInput: false,
			awaitingPermission: isAwaitingPermission({
				sessionId: "session-test-100",
				notifications: [PERMISSION_NOTIFICATION],
				records,
			}),
			unseenError: false,
			liveAgentCount: 0,
			backgroundTasks: [],
			lastSubagentActivityAt: null,
			herdrStatus: null,
			prState: null,
			unseen: false,
			fileMtime: NOW - 8 * 60 * 60 * 1000,
			now: NOW,
		});
	}

	it("needs input while the tool call waits on the prompt, however old the transcript is", () => {
		expect(bucketFor([PENDING_BASH])).toStrictEqual({bucket: "blocked", reason: "pending-input"});
	});

	it("is completed once a tool_result follows", () => {
		expect(bucketFor([PENDING_BASH, BASH_RESULT])).toStrictEqual({bucket: "done", reason: "ended"});
	});
});

describe("resolveMainState", () => {
	const registry = (status: "idle" | "busy" | "waiting" | "shell", statusUpdatedAt: number) => ({
		status,
		statusUpdatedAt,
	});
	const hook = (state: ActivityState, lastActivity: number) => ({state, lastActivity});

	it("maps registry statuses to activity states when no hook entry exists, a `!` shell reading idle as upstream", () => {
		expect(
			(["idle", "busy", "waiting", "shell"] as const).map((status) =>
				resolveMainState({hook: null, registry: registry(status, 1_000)}),
			),
		).toStrictEqual([
			{state: "idle", source: "registry"},
			{state: "working", source: "registry"},
			{state: "waiting", source: "registry"},
			{state: "idle", source: "registry"},
		]);
	});

	it("reads a busy registry status as idle once the transcript's turn ended after it, as upstream does", () => {
		expect([
			resolveMainState({hook: null, registry: registry("busy", 1_000), turnEndedAt: 61_000}),
			resolveMainState({hook: null, registry: registry("busy", 1_000), turnEndedAt: 500}),
			resolveMainState({hook: null, registry: registry("busy", 1_000), turnEndedAt: null}),
			resolveMainState({hook: null, registry: registry("waiting", 1_000), turnEndedAt: 61_000}),
		]).toStrictEqual([
			{state: "idle", source: "registry"},
			{state: "working", source: "registry"},
			{state: "working", source: "registry"},
			{state: "waiting", source: "registry"},
		]);
	});

	it("reads ended without either source and the hook state without a registry entry", () => {
		expect([
			resolveMainState({hook: null, registry: null}),
			resolveMainState({hook: hook("working", 1_000), registry: null}),
		]).toStrictEqual([
			{state: "ended", source: null},
			{state: "working", source: "hook"},
		]);
	});

	it("lets the fresher source win, the registry on a tie, and the registry over an unknown hook state", () => {
		expect([
			resolveMainState({hook: hook("working", 2_000), registry: registry("waiting", 1_000)}),
			resolveMainState({hook: hook("working", 1_000), registry: registry("waiting", 2_000)}),
			resolveMainState({hook: hook("working", 1_000), registry: registry("idle", 1_000)}),
			resolveMainState({hook: hook("unknown", 5_000), registry: registry("busy", 1_000)}),
		]).toStrictEqual([
			{state: "working", source: "hook"},
			{state: "waiting", source: "registry"},
			{state: "idle", source: "registry"},
			{state: "working", source: "registry"},
		]);
	});
});

describe("sessionProcessLive", () => {
	it("counts a session live from its hooks or from any non-ended state its registry gives it", () => {
		expect([
			sessionProcessLive({hookActive: true, summaryState: null}),
			sessionProcessLive({hookActive: false, summaryState: "waiting"}),
			sessionProcessLive({hookActive: false, summaryState: "idle"}),
			sessionProcessLive({hookActive: false, summaryState: "ended"}),
			sessionProcessLive({hookActive: false, summaryState: null}),
		]).toStrictEqual([true, true, true, false, false]);
	});
});
