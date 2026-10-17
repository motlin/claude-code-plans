import {vi} from "vite-plus/test";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {dispatchHookEvent} from "../src/lib/hook-dispatcher";
import {DOMAIN_EVENTS, type HookEvent} from "../src/lib/hook-events";
import {clearAllPendingPlans, getPendingPlan} from "../src/lib/pending-plan-store";

vi.mock("../src/lib/herdr/report-state", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/lib/herdr/report-state")>()),
	reportHookStateToHerdr: () => {
		throw new Error("tests must inject reportHerdrState instead of reaching the real herdr");
	},
}));

let db: AppDb;

const store = {
	markSessionActive: () => {},
	markSessionEnded: () => {},
	setSessionState: () => {},
	touchSession: () => {},
	touchSubagentActivity: () => {},
	setBackgroundTasks: () => {},
	setSessionCrons: () => {},
	setPendingPermissionRequest: () => {},
	getActiveSessionEntry: () => null,
};

const base = {
	session_id: "session-alice",
	transcript_path: "/tmp/pending-plan-test/session-alice.jsonl",
	cwd: "/tmp/pending-plan-test",
} as const;

// The input Claude Code 2.1.302 sends with ExitPlanMode's PreToolUse and PermissionRequest hooks.
const PLAN_INPUT = {
	plan: "# Say hello\n\n1. Print hello",
	planFilePath: "/Users/alice/.claude/plans/say-hello.md",
};

const PRE_TOOL_USE: HookEvent = {
	...base,
	hook_event_name: "PreToolUse",
	tool_name: "ExitPlanMode",
	tool_use_id: "toolu_plan_alice",
	tool_input: PLAN_INPUT,
};

const PERMISSION_REQUEST: HookEvent = {
	...base,
	hook_event_name: "PermissionRequest",
	tool_name: "ExitPlanMode",
	tool_input: PLAN_INPUT,
};

const PENDING = {toolUseId: "toolu_plan_alice", ...PLAN_INPUT};

async function dispatchAll(events: HookEvent[]): Promise<Array<{type: string; data: Record<string, unknown>}>> {
	const broadcasts: Array<{type: string; data: Record<string, unknown>}> = [];
	for (const event of events) {
		await dispatchHookEvent({
			event,
			db: db.index,
			store,
			broadcast: (type, data) => {
				if (type === DOMAIN_EVENTS.SESSION_PENDING_PLAN_CHANGED) broadcasts.push({type, data});
			},
			reportHerdrState: () => {},
		});
	}
	return broadcasts;
}

beforeEach(() => {
	db = openTestDb();
	clearAllPendingPlans();
});

afterEach(() => {
	clearAllPendingPlans();
	db.close();
});

describe("pending ExitPlanMode from hooks", () => {
	it("keeps the PreToolUse plan as the session's pending plan and broadcasts it", async () => {
		const broadcasts = await dispatchAll([PRE_TOOL_USE]);

		expect({broadcasts, pending: getPendingPlan("session-alice")}).toStrictEqual({
			broadcasts: [
				{
					type: DOMAIN_EVENTS.SESSION_PENDING_PLAN_CHANGED,
					data: {sessionId: "session-alice", pendingPlan: PENDING},
				},
			],
			pending: PENDING,
		});
	});

	it("keeps the PreToolUse tool_use_id when the PermissionRequest that follows carries none", async () => {
		const broadcasts = await dispatchAll([PRE_TOOL_USE, PERMISSION_REQUEST]);

		expect({count: broadcasts.length, pending: getPendingPlan("session-alice")}).toStrictEqual({
			count: 1,
			pending: PENDING,
		});
	});

	it("stores a plan from the PermissionRequest alone, with no tool_use_id", async () => {
		const broadcasts = await dispatchAll([PERMISSION_REQUEST]);

		expect({broadcasts, pending: getPendingPlan("session-alice")}).toStrictEqual({
			broadcasts: [
				{
					type: DOMAIN_EVENTS.SESSION_PENDING_PLAN_CHANGED,
					data: {sessionId: "session-alice", pendingPlan: {toolUseId: "", ...PLAN_INPUT}},
				},
			],
			pending: {toolUseId: "", ...PLAN_INPUT},
		});
	});

	it.each([
		{
			name: "PostToolUse for the plan",
			event: {...PRE_TOOL_USE, hook_event_name: "PostToolUse", tool_response: {plan: PLAN_INPUT.plan}},
		},
		{
			name: "PostToolUseFailure for the plan",
			event: {...PRE_TOOL_USE, hook_event_name: "PostToolUseFailure", error: "User rejected"},
		},
		{
			name: "PermissionDenied for the plan",
			event: {...PRE_TOOL_USE, hook_event_name: "PermissionDenied", reason: "denied"},
		},
		{name: "Stop", event: {...base, hook_event_name: "Stop"}},
		{name: "StopFailure", event: {...base, hook_event_name: "StopFailure", error: "rate_limit"}},
		{name: "SessionEnd", event: {...base, hook_event_name: "SessionEnd"}},
		{name: "UserPromptSubmit", event: {...base, hook_event_name: "UserPromptSubmit", prompt: "Never mind"}},
	] as Array<{name: string; event: unknown}>)("clears it on $name", async ({event}) => {
		const broadcasts = await dispatchAll([PRE_TOOL_USE, event as HookEvent]);

		expect({broadcasts: broadcasts.slice(1), pending: getPendingPlan("session-alice")}).toStrictEqual({
			broadcasts: [
				{
					type: DOMAIN_EVENTS.SESSION_PENDING_PLAN_CHANGED,
					data: {sessionId: "session-alice", pendingPlan: null},
				},
			],
			pending: null,
		});
	});

	it("keeps it across unrelated tool hooks and does not broadcast a clear that changed nothing", async () => {
		const bash: HookEvent = {
			...base,
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			tool_use_id: "toolu_bob",
			tool_input: {command: "true"},
			tool_response: {stdout: "", stderr: "", interrupted: false, isImage: false},
		};
		const broadcasts = await dispatchAll([bash, {...base, hook_event_name: "Stop"}, PRE_TOOL_USE, bash]);

		expect({count: broadcasts.length, pending: getPendingPlan("session-alice")}).toStrictEqual({
			count: 1,
			pending: PENDING,
		});
	});

	it("ignores a subagent's plan, which the root session does not wait on", async () => {
		const broadcasts = await dispatchAll([{...PRE_TOOL_USE, agent_id: "agent-bob", agent_type: "Plan"}]);

		expect({broadcasts, pending: getPendingPlan("session-alice")}).toStrictEqual({
			broadcasts: [],
			pending: null,
		});
	});
});
