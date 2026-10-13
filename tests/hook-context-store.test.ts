import {vi} from "vite-plus/test";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {dispatchHookEvent} from "../src/lib/hook-dispatcher";
import {clearHookContexts, getHookContexts} from "../src/lib/hook-context-store";
import {DOMAIN_EVENTS, HookEventEnvelope} from "../src/lib/hook-events";
import {connectEvents} from "../src/lib/sse-connect-events";
import {stopWithScratchpadFixture} from "./fixtures/scratchpad-dir-events";

vi.mock("../src/lib/herdr/report-state", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/lib/herdr/report-state")>()),
	reportHookStateToHerdr: () => {
		throw new Error("tests must inject reportHerdrState instead of reaching the real herdr");
	},
}));

let db: AppDb;

// No SessionStart hook is installed, so the active-session store never has an entry for the session.
const store = {
	markSessionActive: () => {},
	markSessionEnded: () => {},
	setSessionState: () => {},
	touchSession: () => {},
	touchSubagentActivity: () => {},
	setBackgroundTasks: () => {},
	setSessionCrons: () => {},
	getActiveSessionEntry: () => null,
};

async function dispatch(payload: unknown): Promise<void> {
	await dispatchHookEvent({
		event: HookEventEnvelope.parse(payload),
		db: db.index,
		store,
		broadcast: () => {},
		reportHerdrState: () => {},
	});
}

beforeEach(() => {
	db = openTestDb();
	clearHookContexts();
});

afterEach(() => {
	clearHookContexts();
	db.close();
});

const STOP = {
	...stopWithScratchpadFixture,
	background_tasks: [
		{id: "tk100", type: "teammate", status: "running", description: "Parity explorer"},
		{id: "tk200", type: "teammate", status: "running", description: "Parity implementer"},
		{id: "b300", type: "local_bash", status: "running", description: "Run git test", command: "git test run"},
		{id: "a400", type: "local_agent", status: "running", description: "Review the diff"},
	],
};

describe("hook context store", () => {
	it("keeps a Stop's background tasks for a session no SessionStart registered, and sends them to a tab that connects later", async () => {
		await dispatch(STOP);
		const snapshot = connectEvents().find((event) => event.type === DOMAIN_EVENTS.SESSION_HOOK_CONTEXT_CHANGED);

		expect({
			stored: getHookContexts()
				.get("abc-123")
				?.backgroundTasks?.map((task) => task.id),
			snapshot: (JSON.parse(snapshot?.data ?? "{}") as {backgroundTasks?: {id: string}[]}).backgroundTasks?.map(
				(task) => task.id,
			),
		}).toStrictEqual({stored: ["tk100", "tk200", "b300", "a400"], snapshot: ["tk100", "tk200", "b300", "a400"]});
	});

	it("forgets the session's context when it ends", async () => {
		await dispatch(STOP);
		const {session_id, transcript_path, cwd} = stopWithScratchpadFixture;
		await dispatch({session_id, transcript_path, cwd, hook_event_name: "SessionEnd", reason: "logout"});

		expect(getHookContexts().has("abc-123")).toBe(false);
	});
});
