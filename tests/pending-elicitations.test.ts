import {vi} from "vite-plus/test";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {dispatchHookEvent} from "../src/lib/hook-dispatcher";
import {DOMAIN_EVENTS, type HookEvent} from "../src/lib/hook-events";
import {
	clearAllPendingElicitations,
	getAllPendingElicitations,
	getPendingElicitations,
} from "../src/lib/pending-elicitations";
import {SessionElicitationChangedPayloadSchema} from "../src/lib/domain-event-payload-schemas";
import {elicitationFormFixture, elicitationResultFixture, elicitationUrlFixture} from "./fixtures/elicitation";

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

const NOW = 1_790_000_000_000;

const FORM_ENTRY = {
	serverName: "my-mcp-server",
	message: "Please provide your credentials",
	mode: "form",
	requestedSchema: {
		type: "object",
		properties: {
			username: {type: "string", title: "Username"},
		},
	},
	receivedAt: NOW,
};

const URL_ENTRY = {
	serverName: "my-mcp-server",
	message: "Please authenticate",
	mode: "url",
	url: "https://auth.example.com/login",
	receivedAt: NOW,
};

async function dispatchAll(events: HookEvent[]): Promise<Array<{type: string; data: Record<string, unknown>}>> {
	const broadcasts: Array<{type: string; data: Record<string, unknown>}> = [];
	for (const event of events) {
		await dispatchHookEvent({
			event,
			db: db.index,
			store,
			broadcast: (type, data) => {
				if (type === DOMAIN_EVENTS.SESSION_ELICITATION_CHANGED) broadcasts.push({type, data});
			},
			reportHerdrState: () => {},
			isSessionVisible: () => true,
		});
	}
	return broadcasts;
}

beforeEach(() => {
	vi.useFakeTimers({now: NOW, toFake: ["Date"]});
	db = openTestDb();
	clearAllPendingElicitations();
});

afterEach(() => {
	clearAllPendingElicitations();
	db.close();
	vi.useRealTimers();
});

describe("pending elicitations", () => {
	it("keeps a form elicitation's payload until its ElicitationResult arrives", async () => {
		const added = await dispatchAll([elicitationFormFixture]);
		expect(getAllPendingElicitations()).toStrictEqual({"abc-123": [FORM_ENTRY]});
		expect(added).toStrictEqual([
			{
				type: DOMAIN_EVENTS.SESSION_ELICITATION_CHANGED,
				data: {sessionId: "abc-123", pendingElicitations: [FORM_ENTRY]},
			},
		]);
		expect(SessionElicitationChangedPayloadSchema.parse(added[0]?.data)).toStrictEqual({
			sessionId: "abc-123",
			pendingElicitations: [FORM_ENTRY],
		});

		const resolved = await dispatchAll([elicitationResultFixture]);
		expect(getAllPendingElicitations()).toStrictEqual({});
		expect(resolved).toStrictEqual([
			{
				type: DOMAIN_EVENTS.SESSION_ELICITATION_CHANGED,
				data: {sessionId: "abc-123", pendingElicitations: []},
			},
		]);
	});

	it("keeps a url elicitation's url", async () => {
		await dispatchAll([elicitationUrlFixture]);
		expect(getPendingElicitations("abc-123")).toStrictEqual([URL_ENTRY]);
	});

	it("resolves by elicitation_id when both hooks carry one", async () => {
		await dispatchAll([
			{...elicitationFormFixture, elicitation_id: "elicit-1"},
			{...elicitationUrlFixture, elicitation_id: "elicit-2"},
			{...elicitationResultFixture, elicitation_id: "elicit-2"},
		]);
		expect(getAllPendingElicitations()).toStrictEqual({
			"abc-123": [{...FORM_ENTRY, elicitationId: "elicit-1"}],
		});
	});

	it("resolves the oldest entry from the same server when the result has no id", async () => {
		await dispatchAll([
			elicitationFormFixture,
			{...elicitationUrlFixture, mcp_server_name: "other-server"},
			elicitationUrlFixture,
			elicitationResultFixture,
		]);
		expect(getAllPendingElicitations()).toStrictEqual({
			"abc-123": [{...URL_ENTRY, serverName: "other-server"}, URL_ENTRY],
		});
	});

	it("leaves the store alone for a result that matches nothing", async () => {
		const broadcasts = await dispatchAll([elicitationResultFixture]);
		expect({store: getAllPendingElicitations(), broadcasts}).toStrictEqual({store: {}, broadcasts: []});
	});

	it.each([
		{hook_event_name: "Stop" as const, stop_hook_active: false},
		{hook_event_name: "StopFailure" as const, error: "rate_limit"},
		{hook_event_name: "SessionEnd" as const, reason: "other"},
	])("drops the session's elicitations on $hook_event_name", async (ending) => {
		const base = {
			session_id: elicitationFormFixture.session_id,
			transcript_path: elicitationFormFixture.transcript_path,
			cwd: elicitationFormFixture.cwd,
		};
		await dispatchAll([elicitationFormFixture, {...elicitationFormFixture, session_id: "other-session"}]);
		const broadcasts = await dispatchAll([{...base, ...ending}]);
		expect({store: getAllPendingElicitations(), broadcasts}).toStrictEqual({
			store: {"other-session": [FORM_ENTRY]},
			broadcasts: [
				{
					type: DOMAIN_EVENTS.SESSION_ELICITATION_CHANGED,
					data: {sessionId: "abc-123", pendingElicitations: []},
				},
			],
		});
	});
});
