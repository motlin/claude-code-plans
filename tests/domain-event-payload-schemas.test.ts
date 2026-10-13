import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import type {z} from "zod";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {indexSessionsIndex} from "../src/lib/db/indexer";
import {initPendingApprovalsCache, updatePendingApprovalForSession} from "../src/lib/db/pending-approvals-cache";
import {
	HookBackgroundTaskPayloadSchema,
	HookSessionCronPayloadSchema,
	LiveSubagentNodeSchema,
	MemorySummaryPayloadSchema,
	NotificationEntryPayloadSchema,
	PendingApprovalPayloadSchema,
	PlanSummaryPayloadSchema,
	SessionSummaryPayloadSchema,
} from "../src/lib/domain-event-payload-schemas";
import {dispatchHookEvent, type HookDispatchDirs} from "../src/lib/hook-dispatcher";
import {DOMAIN_EVENTS} from "../src/lib/hook-events";
import {
	addLiveSubagent,
	clearLiveSubagents,
	endLiveSubagent,
	getLiveSubagentNodes,
} from "../src/lib/live-subagent-store";
import {asRecord} from "../src/lib/narrow";
import {clearAllNotifications} from "../src/lib/notifications-store";
import {buildSessionSummaryPayloadFromDb, toSessionSummaryPayload} from "../src/lib/session-summary";

/**
 * The client validates every SSE domain-event payload with the strict schemas in
 * `domain-event-payload-schemas.ts` and silently skips any that fail. These tests
 * build each payload with the real server code that emits it, send it through
 * the same JSON round trip as the SSE wire, and require the schema to accept it
 * unchanged — so a field added on the server cannot be dropped on the floor.
 */

type Broadcast = {type: string; data: Record<string, unknown>};

const typedBroadcasts: Broadcast[] = [];

vi.mock("../src/lib/sse-broadcast", () => ({
	broadcastTyped: (type: string, data: Record<string, unknown>) => {
		typedBroadcasts.push({type, data});
	},
}));

const testDir = join(tmpdir(), "claude-domain-event-payload-schemas-test-" + process.pid);
const PROJECT_ID = "-tmp-test-alice-project";
const SESSION_ID = "session-test-100";
let db: AppDb;

function overTheWire(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value));
}

function expectAccepted<T>(schema: z.ZodType<T>, payload: T): void {
	expect(schema.safeParse(overTheWire(payload))).toStrictEqual({success: true, data: payload});
}

function payloadOf(broadcasts: Broadcast[], type: string, key: string): unknown {
	const broadcast = broadcasts.find((candidate) => candidate.type === type);
	if (broadcast === undefined) throw new Error(`Expected a ${type} broadcast`);
	return broadcast.data[key];
}

function makeDirs(): HookDispatchDirs {
	return {
		projectsDir: join(testDir, "projects"),
		plansDir: join(testDir, "plans"),
		tasksDir: join(testDir, "tasks"),
		commandsDir: join(testDir, "commands"),
		pluginsDir: join(testDir, "plugins", "cache"),
		statuslineDir: join(testDir, "statusline"),
	};
}

function makeStore() {
	return {
		setSessionCrons: () => {},
		touchSubagentActivity: () => {},
		setBackgroundTasks: () => {},
		markSessionActive: () => {},
		markSessionEnded: () => {},
		setSessionState: () => {},
		touchSession: () => {},
		getActiveSessionEntry: () => null,
	};
}

async function dispatch(event: Parameters<typeof dispatchHookEvent>[0]["event"]): Promise<Broadcast[]> {
	const broadcasts: Broadcast[] = [];
	await dispatchHookEvent({
		event,
		db: db.index,
		store: makeStore(),
		broadcast: (type, data) => broadcasts.push({type, data}),
		dirs: makeDirs(),
		reportHerdrState: () => {},
		isSessionVisible: () => true,
	});
	return broadcasts;
}

beforeEach(async () => {
	mkdirSync(testDir, {recursive: true});
	db = openTestDb();
	typedBroadcasts.length = 0;
	clearLiveSubagents();
	clearAllNotifications();
	await initPendingApprovalsCache(db.index);
});

afterEach(() => {
	clearLiveSubagents();
	clearAllNotifications();
	db.close();
	rmSync(testDir, {recursive: true, force: true});
});

describe("domain event payload schemas accept the payloads the server emits", () => {
	it("SessionSummaryPayload from the index DB (no branch, PR, or fork)", async () => {
		const projectDir = join(testDir, PROJECT_ID);
		mkdirSync(projectDir, {recursive: true});
		const transcriptPath = join(projectDir, `${SESSION_ID}.jsonl`);
		writeFileSync(transcriptPath, "");
		writeFileSync(
			join(projectDir, "sessions-index.json"),
			JSON.stringify({
				version: 1,
				entries: [
					{
						sessionId: SESSION_ID,
						fullPath: transcriptPath,
						fileMtime: 946_598_400_000,
						firstPrompt: "Fix the test login bug",
						messageCount: 5,
						projectPath: "/tmp/test/alice-project",
					},
				],
			}),
		);
		await indexSessionsIndex(db.index, projectDir, PROJECT_ID);

		const payload = buildSessionSummaryPayloadFromDb(db.index, SESSION_ID, () => null);
		if (payload === null) throw new Error("Expected the indexed session");
		expectAccepted(SessionSummaryPayloadSchema, payload);
	});

	it("SessionSummaryPayload with every optional field present", () => {
		const payload = toSessionSummaryPayload(
			{
				id: SESSION_ID,
				title: "Fix the test login bug",
				summary: "Fixed the test auth issue",
				mtime: new Date(946_598_400_000),
				created: new Date(946_598_300_000),
				project: PROJECT_ID,
				projectName: "alice-project",
				messageCount: 5,
				gitBranch: "feature/test-login",
				isSidechain: false,
				forkedFromSessionId: "session-test-200",
				pr: {number: 100, url: "https://example.com/example/repo/pull/100", repository: "example/repo"},
			},
			{
				unseen: true,
				archived: true,
				activeSession: null,
				registrySession: null,
				prStatus: {
					number: 100,
					state: "open",
					url: "https://example.com/example/repo/pull/100",
					title: "Fix the test login bug",
					checks: {passed: 3, failed: 1, pending: 2},
					review: "APPROVED",
				},
				now: 946_598_500_000,
			},
		);
		expectAccepted(SessionSummaryPayloadSchema, payload);
	});

	it("PendingApprovalPayload for an unanswered AskUserQuestion", async () => {
		const transcriptPath = join(testDir, `${SESSION_ID}.jsonl`);
		writeFileSync(
			transcriptPath,
			`${JSON.stringify({
				type: "assistant",
				sessionId: SESSION_ID,
				timestamp: "2026-05-14T10:00:00.000Z",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_question",
							name: "AskUserQuestion",
							input: {
								questions: [
									{
										question: "Which test fixture should we use?",
										header: "Fixture",
										multiSelect: false,
										options: [
											{label: "Alpha", description: "The alpha fixture"},
											{label: "Beta", description: "The beta fixture"},
										],
									},
								],
							},
						},
					],
				},
			})}\n`,
		);
		const broadcasts: Broadcast[] = [];
		await updatePendingApprovalForSession(
			db.index,
			SESSION_ID,
			transcriptPath,
			PROJECT_ID,
			"alice-project",
			(type, data) => broadcasts.push({type, data}),
		);

		const approval = PendingApprovalPayloadSchema.parse(
			overTheWire(payloadOf(broadcasts, DOMAIN_EVENTS.APPROVAL_CHANGED, "approval")),
		);
		expect(approval).toStrictEqual({
			sessionId: SESSION_ID,
			projectId: PROJECT_ID,
			projectName: "alice-project",
			toolName: "AskUserQuestion",
			toolUseId: "toolu_question",
			blockedSince: "2026-05-14T10:00:00.000Z",
			planFilename: null,
			questionPreview: "Which test fixture should we use?",
			questionOptions: ["Alpha", "Beta"],
		});
	});

	it("PlanSummaryPayload from a plan edit", async () => {
		const dirs = makeDirs();
		mkdirSync(dirs.plansDir, {recursive: true});
		const planPath = join(dirs.plansDir, "2026-05-20-test-plan.md");
		writeFileSync(planPath, "# Test Plan Title\n\nBody.\n");

		const broadcasts = await dispatch({
			hook_event_name: "PostToolUse",
			session_id: SESSION_ID,
			transcript_path: "/tmp/missing.jsonl",
			cwd: "/tmp",
			tool_name: "Write",
			tool_input: {file_path: planPath, content: "# Test Plan Title\n\nBody.\n"},
		});

		const plan = PlanSummaryPayloadSchema.safeParse(
			overTheWire(payloadOf(broadcasts, DOMAIN_EVENTS.PLAN_CHANGED, "plan")),
		);
		expect(plan.success).toBe(true);
		expect(plan.data?.title).toBe("Test Plan Title");
	});

	it("MemorySummaryPayload from a memory edit", async () => {
		const dirs = makeDirs();
		const memoryDir = join(dirs.projectsDir, PROJECT_ID, "memory");
		mkdirSync(memoryDir, {recursive: true});
		const memoryPath = join(memoryDir, "test-memory.md");
		writeFileSync(memoryPath, "# Test Memory Title\n\nRemember this.\n");

		const broadcasts = await dispatch({
			hook_event_name: "PostToolUse",
			session_id: SESSION_ID,
			transcript_path: "/tmp/missing.jsonl",
			cwd: "/tmp",
			tool_name: "Write",
			tool_input: {file_path: memoryPath, content: "# Test Memory Title\n\nRemember this.\n"},
		});

		const memory = MemorySummaryPayloadSchema.safeParse(
			overTheWire(payloadOf(broadcasts, DOMAIN_EVENTS.MEMORY_CHANGED, "memory")),
		);
		expect(memory.success).toBe(true);
		expect(memory.data?.filename).toBe("test-memory.md");
	});

	it.each([
		["with a title", {title: "Claude Code"}],
		["without a title", {}],
	])("NotificationEntryPayload %s", async (_name, title) => {
		await dispatch({
			hook_event_name: "Notification",
			session_id: SESSION_ID,
			transcript_path: "/tmp/missing.jsonl",
			cwd: "/tmp/test/alice-project",
			message: "Claude needs your permission to use Bash",
			notification_type: "permission_prompt",
			...title,
		});

		const sent = payloadOf(typedBroadcasts, DOMAIN_EVENTS.NOTIFICATION_ADDED, "notification");
		const notification = NotificationEntryPayloadSchema.safeParse(overTheWire(sent));
		expect(notification).toStrictEqual({success: true, data: sent});
	});

	it("LiveSubagentNode in the subagents snapshot, running and ended", () => {
		addLiveSubagent({
			parentSessionId: SESSION_ID,
			agentId: "agent-test-100",
			agentType: "Explore",
			description: "Inspect the example project",
		});
		addLiveSubagent({
			parentSessionId: "agent-test-100",
			agentId: "agent-test-200",
			agentType: "general-purpose",
			description: "Nested helper",
		});
		endLiveSubagent("agent-test-200");

		const nodes = getLiveSubagentNodes();
		expect(nodes.map((node) => node.endedAt === null)).toStrictEqual([true, false]);
		for (const node of nodes) {
			expectAccepted(LiveSubagentNodeSchema, node);
		}
	});

	it("HookBackgroundTaskPayload and HookSessionCronPayload from a Stop hook", async () => {
		const broadcasts = await dispatch({
			hook_event_name: "Stop",
			session_id: SESSION_ID,
			transcript_path: "/tmp/missing.jsonl",
			cwd: "/tmp/test/alice-project",
			background_tasks: [
				{
					id: "task-test-100",
					type: "local_bash",
					status: "running",
					description: "Run the test server",
					command: "npm run dev",
				},
				{
					id: "task-test-200",
					type: "local_agent",
					status: "running",
					description: "Inspect the example project",
					agent_type: "Explore",
				},
				{
					id: "task-test-300",
					type: "mcp_tool",
					status: "running",
					description: "Query the example server",
					server: "example",
					tool: "query",
					name: "example-query",
				},
			],
			session_crons: [{id: "cron-test-100", schedule: "0 * * * *", recurring: true, prompt: "Check the service"}],
		});

		const context = broadcasts.find((broadcast) => broadcast.type === DOMAIN_EVENTS.SESSION_HOOK_CONTEXT_CHANGED);
		if (context === undefined) throw new Error("Expected a session:hook-context-changed broadcast");
		const wire = asRecord(overTheWire(context.data));
		const tasks = wire?.["backgroundTasks"];
		const crons = wire?.["sessionCrons"];
		if (!Array.isArray(tasks) || !Array.isArray(crons)) throw new Error("Expected task and cron arrays");
		expect(tasks.map((task) => HookBackgroundTaskPayloadSchema.safeParse(task).success)).toStrictEqual([
			true,
			true,
			true,
		]);
		expect(crons.map((cron) => HookSessionCronPayloadSchema.safeParse(cron).success)).toStrictEqual([true]);
	});
});
