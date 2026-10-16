import {vi} from "vite-plus/test";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {dispatchHookEvent} from "../src/lib/hook-dispatcher";
import {DOMAIN_EVENTS, HookEventEnvelope, type HookEvent} from "../src/lib/hook-events";
import {clearAllPendingQuestions, getPendingQuestion} from "../src/lib/pending-question-store";
import {preToolUseWithScratchpadFixture} from "./fixtures/scratchpad-dir-events";

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
	transcript_path: "/tmp/pending-question-test/session-alice.jsonl",
	cwd: "/tmp/pending-question-test",
} as const;

// The shape Claude Code writes for a real AskUserQuestion call's input.
const QUESTIONS_INPUT = {
	questions: [
		{
			question: "Which color do you prefer?",
			header: "Color",
			multiSelect: false,
			options: [
				{label: "Red", description: "A warm color."},
				{label: "Blue", description: "A cool color.", preview: "blue swatch"},
			],
		},
		{
			question: "Which toppings?",
			header: "Toppings",
			multiSelect: true,
			options: [{label: "Cheese"}, {label: "Olives", description: "Black olives."}],
		},
	],
};

const ASK: HookEvent = {
	...base,
	hook_event_name: "PreToolUse",
	tool_name: "AskUserQuestion",
	tool_use_id: "toolu_alice",
	tool_input: QUESTIONS_INPUT,
};

const PENDING = {
	toolUseId: "toolu_alice",
	questions: [
		{
			question: "Which color do you prefer?",
			header: "Color",
			multiSelect: false,
			options: [
				{label: "Red", description: "A warm color."},
				{label: "Blue", description: "A cool color."},
			],
		},
		{
			question: "Which toppings?",
			header: "Toppings",
			multiSelect: true,
			options: [{label: "Cheese"}, {label: "Olives", description: "Black olives."}],
		},
	],
};

async function dispatchAll(events: HookEvent[]): Promise<Array<{type: string; data: Record<string, unknown>}>> {
	const broadcasts: Array<{type: string; data: Record<string, unknown>}> = [];
	for (const event of events) {
		await dispatchHookEvent({
			event,
			db: db.index,
			store,
			broadcast: (type, data) => {
				if (type === DOMAIN_EVENTS.SESSION_PENDING_QUESTION_CHANGED) broadcasts.push({type, data});
			},
			reportHerdrState: () => {},
		});
	}
	return broadcasts;
}

beforeEach(() => {
	db = openTestDb();
	clearAllPendingQuestions();
});

afterEach(() => {
	clearAllPendingQuestions();
	db.close();
});

describe("pending AskUserQuestion from hooks", () => {
	it("stores the question from a real Claude Code 2.1.296 payload, which carries scratchpad_dir", async () => {
		await dispatchAll([HookEventEnvelope.parse(preToolUseWithScratchpadFixture)]);

		expect(getPendingQuestion("abc-123")?.toolUseId).toBe("toolu_abc");
	});

	it("keeps the PreToolUse questions as the session's pending question and broadcasts them", async () => {
		const broadcasts = await dispatchAll([ASK]);

		expect({broadcasts, pending: getPendingQuestion("session-alice")}).toStrictEqual({
			broadcasts: [
				{
					type: DOMAIN_EVENTS.SESSION_PENDING_QUESTION_CHANGED,
					data: {sessionId: "session-alice", pendingQuestion: PENDING},
				},
			],
			pending: PENDING,
		});
	});

	it.each([
		{
			name: "PostToolUse for the question",
			event: {
				...base,
				hook_event_name: "PostToolUse",
				tool_name: "AskUserQuestion",
				tool_use_id: "toolu_alice",
				tool_input: QUESTIONS_INPUT,
			},
		},
		{
			name: "PostToolUseFailure for the question",
			event: {
				...base,
				hook_event_name: "PostToolUseFailure",
				tool_name: "AskUserQuestion",
				tool_use_id: "toolu_alice",
				tool_input: QUESTIONS_INPUT,
				error: "Interrupted",
			},
		},
		{name: "Stop", event: {...base, hook_event_name: "Stop"}},
		{name: "SessionEnd", event: {...base, hook_event_name: "SessionEnd"}},
		{name: "UserPromptSubmit", event: {...base, hook_event_name: "UserPromptSubmit", prompt: "Never mind"}},
	] satisfies Array<{name: string; event: HookEvent}>)("clears it on $name", async ({event}) => {
		const broadcasts = await dispatchAll([ASK, event]);

		expect({broadcasts: broadcasts.slice(1), pending: getPendingQuestion("session-alice")}).toStrictEqual({
			broadcasts: [
				{
					type: DOMAIN_EVENTS.SESSION_PENDING_QUESTION_CHANGED,
					data: {sessionId: "session-alice", pendingQuestion: null},
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
		};
		const broadcasts = await dispatchAll([bash, {...base, hook_event_name: "Stop"}, ASK, bash]);

		expect({count: broadcasts.length, pending: getPendingQuestion("session-alice")}).toStrictEqual({
			count: 1,
			pending: PENDING,
		});
	});

	it("ignores a subagent's question, which the root session does not wait on", async () => {
		const broadcasts = await dispatchAll([{...ASK, agent_id: "agent-bob", agent_type: "Explore"}]);

		expect({broadcasts, pending: getPendingQuestion("session-alice")}).toStrictEqual({
			broadcasts: [],
			pending: null,
		});
	});
});
