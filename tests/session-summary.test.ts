import {writeFileSync, mkdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {indexJsonlFile, indexSessionsIndex} from "../src/lib/db/indexer";
import {
	getActiveSessionEntries,
	markSessionActive,
	markSessionEnded,
	setSessionState,
	type ActiveSessionEntry,
} from "../src/lib/active-session-store";
import {buildSessionSummaryPayloadFromDb, toActiveSessionPayload} from "../src/lib/session-summary";
import {initPendingApprovalsCache} from "../src/lib/db/pending-approvals-cache";
import {addLiveSubagent, clearLiveSubagents} from "../src/lib/live-subagent-store";
import {addNotification, clearAllNotifications} from "../src/lib/notifications-store";
import {clearSessionRegistry, refreshSessionRegistry} from "../src/lib/session-registry-store";

const testDir = join(tmpdir(), "claude-session-summary-test-" + process.pid);
const PROJECT_ID = "-tmp-test-alice-project";
const PROJECT_PATH = "/tmp/test/alice-project";
let db: AppDb;

function makeSessionsIndex(entries: Record<string, unknown>[]): string {
	return JSON.stringify({version: 1, entries});
}

beforeEach(async () => {
	mkdirSync(testDir, {recursive: true});
	db = openTestDb();
	clearLiveSubagents();
	for (const entry of getActiveSessionEntries()) {
		markSessionEnded(entry.sessionId);
	}
	await initPendingApprovalsCache(db.index);
});

afterEach(() => {
	for (const entry of getActiveSessionEntries()) {
		markSessionEnded(entry.sessionId);
	}
	clearLiveSubagents();
	db.close();
	rmSync(testDir, {recursive: true, force: true});
});

async function indexSession(transcript = ""): Promise<void> {
	const projectDir = join(testDir, PROJECT_ID);
	mkdirSync(projectDir, {recursive: true});
	const transcriptPath = join(projectDir, "session-test-100.jsonl");
	writeFileSync(transcriptPath, transcript);
	writeFileSync(
		join(projectDir, "sessions-index.json"),
		makeSessionsIndex([
			{
				sessionId: "session-test-100",
				fullPath: transcriptPath,
				fileMtime: 946_598_400_000,
				firstPrompt: "Fix the test login bug",
				summary: "Fixed the test auth issue",
				messageCount: 5,
				projectPath: PROJECT_PATH,
			},
		]),
	);
	await indexSessionsIndex(db.index, projectDir, PROJECT_ID);
}

describe("toActiveSessionPayload", () => {
	it("maps an ActiveSessionEntry into an ActiveSessionPayload 1:1", () => {
		const entry: ActiveSessionEntry = {
			sessionId: "abc-123",
			state: "working",
			cwd: "/home/user/project",
			model: "claude-sonnet-4-6",
			startedAt: 946_598_400_000,
			lastActivity: 946_598_401_000,
			claudeEnv: {},
			tmuxPane: "",
			tmuxServerSocket: "",
			herdrPane: "",
			herdrWorkspace: "",
			herdrSocketPath: "",
			lastSubagentActivityAt: null,
			backgroundTasks: [],
		};

		const payload = toActiveSessionPayload(entry);

		expect(payload).toStrictEqual({
			sessionId: "abc-123",
			cwd: "/home/user/project",
			model: "claude-sonnet-4-6",
			startedAt: 946_598_400_000,
			lastActivity: 946_598_401_000,
		});
	});
});

describe("buildSessionSummaryPayloadFromDb", () => {
	it("returns a SessionSummaryPayload for a known session id", async () => {
		await indexSession();

		const payload = buildSessionSummaryPayloadFromDb(db.index, "session-test-100");

		expect(payload).toStrictEqual({
			id: "session-test-100",
			title: "Fixed the test auth issue",
			summary: "Fixed the test auth issue",
			mtime: "1999-12-31T00:00:00.000Z",
			created: "1999-12-31T00:00:00.000Z",
			// indexSessionsIndex no longer trusts the sessions-index messageCount;
			// the transcript is empty so the canonical count is 0.
			messageCount: 0,
			project: PROJECT_ID,
			projectName: "alice-project",
			gitBranch: undefined,
			archived: false,
			state: "ended",
			bucket: "done",
			liveAgentCount: 0,
			unseen: false,
			blockedSince: null,
		});
	});

	it("uses the active-session state when no durable approval exists", async () => {
		await indexSession();
		markSessionActive("session-test-100", {cwd: PROJECT_PATH, model: "claude-test-model"});
		setSessionState("session-test-100", "working");

		const payload = buildSessionSummaryPayloadFromDb(db.index, "session-test-100");

		expect(payload).toStrictEqual({
			id: "session-test-100",
			title: "Fixed the test auth issue",
			summary: "Fixed the test auth issue",
			mtime: "1999-12-31T00:00:00.000Z",
			created: "1999-12-31T00:00:00.000Z",
			// indexSessionsIndex no longer trusts the sessions-index messageCount;
			// the transcript is empty so the canonical count is 0.
			messageCount: 0,
			project: PROJECT_ID,
			projectName: "alice-project",
			gitBranch: undefined,
			archived: false,
			state: "working",
			bucket: "working",
			liveAgentCount: 0,
			unseen: false,
			blockedSince: null,
		});
	});

	it("prefers a durable pending approval over the active-session state", async () => {
		await indexSession(
			JSON.stringify({
				type: "assistant",
				sessionId: "session-test-100",
				timestamp: "2000-01-01T00:00:00.000Z",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-test-100",
							name: "AskUserQuestion",
							input: {question: "Continue the test?"},
						},
					],
				},
			}) + "\n",
		);
		markSessionActive("session-test-100", {cwd: PROJECT_PATH, model: "claude-test-model"});
		setSessionState("session-test-100", "idle");
		await initPendingApprovalsCache(db.index);

		const payload = buildSessionSummaryPayloadFromDb(db.index, "session-test-100");

		expect(payload).toStrictEqual({
			id: "session-test-100",
			title: "Fixed the test auth issue",
			summary: "Fixed the test auth issue",
			mtime: "1999-12-31T00:00:00.000Z",
			created: "1999-12-31T00:00:00.000Z",
			// indexSessionsIndex no longer trusts the sessions-index messageCount;
			// the transcript is empty so the canonical count is 0.
			messageCount: 0,
			project: PROJECT_ID,
			projectName: "alice-project",
			gitBranch: undefined,
			archived: false,
			state: "waiting",
			bucket: "blocked",
			liveAgentCount: 0,
			unseen: false,
			blockedSince: "2000-01-01T00:00:00.000Z",
		});
	});

	it("needs input for an ended session still blocked on a permission prompt", async () => {
		await indexSession();
		clearAllNotifications();
		addNotification(db.index, {
			sessionId: "session-test-100",
			cwd: PROJECT_PATH,
			message: "Claude needs your permission to use Bash",
			notificationType: "permission_prompt",
		});

		const payload = buildSessionSummaryPayloadFromDb(db.index, "session-test-100");
		clearAllNotifications();

		expect({state: payload?.state, bucket: payload?.bucket}).toStrictEqual({state: "waiting", bucket: "blocked"});
	});

	it("keeps an idle session working while its subagents are live", async () => {
		await indexSession();
		markSessionActive("session-test-100", {cwd: PROJECT_PATH, model: "claude-test-model"});
		setSessionState("session-test-100", "idle");
		addLiveSubagent({
			parentSessionId: "session-test-100",
			agentId: "agent-test-1",
			agentType: "Explore",
			description: "Search the test fixtures",
		});

		const payload = buildSessionSummaryPayloadFromDb(db.index, "session-test-100");

		expect(payload).toStrictEqual({
			id: "session-test-100",
			title: "Fixed the test auth issue",
			summary: "Fixed the test auth issue",
			mtime: "1999-12-31T00:00:00.000Z",
			created: "1999-12-31T00:00:00.000Z",
			messageCount: 0,
			project: PROJECT_ID,
			projectName: "alice-project",
			gitBranch: undefined,
			archived: false,
			state: "idle",
			bucket: "working",
			liveAgentCount: 1,
			unseen: false,
			blockedSince: null,
		});
	});

	it("returns null when the session id is not in the db", () => {
		const payload = buildSessionSummaryPayloadFromDb(db.index, "does-not-exist");

		expect(payload).toBe(null);
	});
});

describe("buildSessionSummaryPayloadFromDb with the CLI session registry", () => {
	const askUserQuestionTranscript =
		JSON.stringify({
			type: "assistant",
			sessionId: "session-test-100",
			timestamp: "2000-01-01T00:00:00.000Z",
			message: {
				role: "assistant",
				content: [{type: "tool_use", id: "tool-test-100", name: "AskUserQuestion", input: {question: "Go?"}}],
			},
		}) + "\n";

	async function registerProcess(status: "idle" | "busy" | "waiting", statusUpdatedAt: number): Promise<void> {
		const dir = join(testDir, "sessions");
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, "4242.json"),
			JSON.stringify({
				pid: 4242,
				sessionId: "session-test-100",
				cwd: PROJECT_PATH,
				startedAt: 946_598_400_000,
				procStart: "Fri Dec 31 00:00:00 1999",
				version: "2.0.0",
				kind: "interactive",
				entrypoint: "cli",
				pidDomain: "darwin",
				status,
				...(status === "waiting" ? {waitingFor: "input needed"} : {}),
				updatedAt: statusUpdatedAt,
				statusUpdatedAt,
			}),
		);
		await refreshSessionRegistry(dir, {isAlive: () => true, readStartTimes: async () => Promise.resolve(null)});
	}

	function stateOf(): {
		state: string | undefined;
		bucket: string | undefined;
		blockedSince: string | null | undefined;
	} {
		const payload = buildSessionSummaryPayloadFromDb(db.index, "session-test-100");
		return {state: payload?.state, bucket: payload?.bucket, blockedSince: payload?.blockedSince};
	}

	afterEach(() => {
		clearSessionRegistry();
	});

	it("needs input while the registry says waiting, blocked since the status write", async () => {
		await indexSession();
		await registerProcess("waiting", 946_598_402_000);

		expect(stateOf()).toStrictEqual({
			state: "waiting",
			bucket: "blocked",
			blockedSince: "1999-12-31T00:00:02.000Z",
		});
	});

	it("is working while the registry says busy, and idle (not ended) when idle", async () => {
		await indexSession();
		await registerProcess("busy", 946_598_402_000);
		const busy = stateOf();
		await registerProcess("idle", 946_598_403_000);

		expect([busy, stateOf()]).toStrictEqual([
			{state: "working", bucket: "working", blockedSince: null},
			{state: "idle", bucket: "done", blockedSince: null},
		]);
	});

	it("ignores an orphaned transcript question while the registry says the process is idle", async () => {
		await indexSession(askUserQuestionTranscript);
		await initPendingApprovalsCache(db.index);
		await registerProcess("idle", 946_598_402_000);

		expect(stateOf()).toStrictEqual({state: "idle", bucket: "done", blockedSince: null});
	});

	it("blocks on a real-shaped registry file waiting on a permission prompt", async () => {
		await indexSession();
		const dir = join(testDir, "sessions");
		mkdirSync(dir, {recursive: true});
		// Key order and fields as the CLI writes them (2026-10), values sanitized.
		writeFileSync(
			join(dir, "29232.json"),
			JSON.stringify({
				pid: 29232,
				sessionId: "session-test-100",
				cwd: PROJECT_PATH,
				startedAt: 946_598_400_000,
				procStart: "Fri Dec 31 00:00:00 1999",
				version: "2.0.0",
				peerProtocol: 1,
				peerFeatures: ["notify_idle", "reply_across_default_dirs", "artifact_yield"],
				kind: "interactive",
				entrypoint: "cli",
				pidDomain: "darwin",
				messagingSocketPath: "/tmp/test/alice.sock",
				name: "test-session",
				nameSource: "auto",
				nameSince: 946_598_400_000,
				updatedAt: 946_598_402_000,
				status: "waiting",
				statusUpdatedAt: 946_598_402_000,
				bridgeSessionId: "session_test0001",
				waitingFor: "permission prompt",
			}),
		);
		await refreshSessionRegistry(dir, {isAlive: () => true, readStartTimes: async () => Promise.resolve(null)});

		expect({
			...stateOf(),
			awaitingPermission: buildSessionSummaryPayloadFromDb(db.index, "session-test-100")?.awaitingPermission,
		}).toStrictEqual({
			state: "waiting",
			bucket: "blocked",
			blockedSince: "1999-12-31T00:00:02.000Z",
			awaitingPermission: true,
		});
	});

	it("flags no permission wait while the registry waits for input", async () => {
		await indexSession();
		await registerProcess("waiting", 946_598_402_000);

		expect(
			Object.hasOwn(buildSessionSummaryPayloadFromDb(db.index, "session-test-100") ?? {}, "awaitingPermission"),
		).toBe(false);
	});

	it("reads a stale busy registry status as idle once the transcript records the turn ending after it", async () => {
		const turnEnd = (timestamp: string) =>
			`${JSON.stringify({type: "system", subtype: "turn_duration", durationMs: 1000, timestamp, uuid: "u1", sessionId: "session-test-100"})}\n`;
		await indexSession(turnEnd("1999-12-31T00:01:02.000Z"));
		await indexJsonlFile(db.index, join(testDir, PROJECT_ID, "session-test-100.jsonl"), PROJECT_ID);
		await registerProcess("busy", 946_598_402_000);
		const ended = stateOf().state;
		await indexSession(turnEnd("1999-12-31T00:00:01.000Z"));
		await indexJsonlFile(db.index, join(testDir, PROJECT_ID, "session-test-100.jsonl"), PROJECT_ID);

		expect([ended, stateOf().state]).toStrictEqual(["idle", "working"]);
	});

	it("lets a hook state written after the registry status win", async () => {
		await indexSession();
		await registerProcess("waiting", 946_598_402_000);
		markSessionActive("session-test-100", {cwd: PROJECT_PATH, model: "claude-test-model"});
		setSessionState("session-test-100", "working");

		expect(stateOf()).toStrictEqual({state: "working", bucket: "working", blockedSince: null});
	});
});
