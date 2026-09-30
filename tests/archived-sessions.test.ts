import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import type {ActiveSessionEntry} from "../src/lib/active-session-store";
import {countSessionsNeedingAttention, shouldNotify} from "../src/lib/attention";
import {openAppDb, openTestDb, type AppDb} from "../src/lib/db/connection";
import {
	getArchivedSessionIds,
	getSessionsByIds,
	isSessionArchived,
	listRecentSessionsFromDb,
	listSessionGroupsFromDb,
	listSessionsForProjectFromDb,
	setSessionArchived,
} from "../src/lib/db/queries";
import * as schema from "../src/lib/db/schema";
import {dispatchHookEvent} from "../src/lib/hook-dispatcher";
import {DOMAIN_EVENTS} from "../src/lib/hook-events";
import {buildSessionSummaryPayloadFromDb} from "../src/lib/session-summary";

// The production herdr reporter reads the real config and talks to the real
// herdr socket on a detached promise that can log after the test ends. Tests
// must inject their own reporter; fail loudly if the real one is reached.
vi.mock("../src/lib/herdr/report-state", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/lib/herdr/report-state")>()),
	reportHookStateToHerdr: () => {
		throw new Error("tests must inject reportHerdrState instead of reaching the real herdr");
	},
}));

type Broadcast = {type: string; data: Record<string, unknown>};
type ApiHandler = (context: {params: {id: string}; request: Request}) => Response | Promise<Response>;

const PROJECT_ID = "project-test-100";
const ALICE = "session-alice-100";
const BOB = "session-bob-200";
const CAROL = "session-carol-300";

let db: AppDb;
const tempDirs: string[] = [];

function seedSessions(target: AppDb): void {
	target.index.insert(schema.projects).values({id: PROJECT_ID, name: "Alice project", updatedAt: 1_000}).run();
	target.index
		.insert(schema.sessions)
		.values(
			[ALICE, BOB, CAROL].map((id, i) => ({
				id,
				projectId: PROJECT_ID,
				title: `Title ${id}`,
				messageCount: 1,
				createdAt: 1_000,
				mtimeMs: 3_000 - i * 1_000,
				filePath: `/fixtures/${id}.jsonl`,
			})),
		)
		.run();
}

function archivedRows(target: AppDb) {
	return target.index.select().from(schema.archivedSessions).all();
}

beforeEach(() => {
	db = openTestDb();
	seedSessions(db);
});

afterEach(() => {
	db.close();
	for (const dir of tempDirs.splice(0)) rmSync(dir, {recursive: true, force: true});
	vi.doUnmock("../src/lib/db");
	vi.doUnmock("../src/lib/sse-broadcast");
	vi.resetModules();
});

describe("archive flag", () => {
	it("archives idempotently, keeping the first archived_at", () => {
		const results = [
			setSessionArchived(db.index, BOB, true, 5_000),
			setSessionArchived(db.index, BOB, true, 6_000),
		];

		expect({
			results,
			rows: archivedRows(db),
			archived: isSessionArchived(db.index, BOB),
			ids: getArchivedSessionIds(db.index),
		}).toStrictEqual({
			results: [true, true],
			rows: [{sessionId: BOB, archivedAt: 5_000}],
			archived: true,
			ids: new Set([BOB]),
		});
	});

	it("unarchives idempotently", () => {
		setSessionArchived(db.index, BOB, true, 5_000);
		const results = [setSessionArchived(db.index, BOB, false), setSessionArchived(db.index, BOB, false)];

		expect({
			results,
			rows: archivedRows(db),
			archived: isSessionArchived(db.index, BOB),
		}).toStrictEqual({results: [false, false], rows: [], archived: false});
	});
});

describe("list queries", () => {
	beforeEach(() => {
		setSessionArchived(db.index, BOB, true, 5_000);
	});

	it("recent sessions exclude archived by default and include them with a status filter", () => {
		const ids = (status?: "active" | "archived" | "all") =>
			listRecentSessionsFromDb(db.index, status ? {limit: 10, status} : {limit: 10}).sessions.map((s) => s.id);

		expect({
			default: ids(),
			active: ids("active"),
			archived: ids("archived"),
			all: ids("all"),
		}).toStrictEqual({
			default: [ALICE, CAROL],
			active: [ALICE, CAROL],
			archived: [BOB],
			all: [ALICE, BOB, CAROL],
		});
	});

	it("recent sessions paginate past archived rows", () => {
		const first = listRecentSessionsFromDb(db.index, {limit: 1});
		const second = listRecentSessionsFromDb(db.index, {
			limit: 1,
			before: first.nextCursor!,
		});

		expect({
			first: first.sessions.map((s) => s.id),
			second: second.sessions.map((s) => s.id),
			nextCursor: second.nextCursor,
		}).toStrictEqual({first: [ALICE], second: [CAROL], nextCursor: null});
	});

	it("grouped sessions exclude archived rows from the slice and the count", () => {
		const summarize = (status?: "active" | "archived" | "all") =>
			listSessionGroupsFromDb(db.index, status ? {status} : {}).map((g) => ({
				project: g.project,
				sessionCount: g.sessionCount,
				ids: g.sessions.map((s) => s.id),
			}));

		expect({
			default: summarize(),
			archived: summarize("archived"),
			all: summarize("all"),
		}).toStrictEqual({
			default: [{project: PROJECT_ID, sessionCount: 2, ids: [ALICE, CAROL]}],
			archived: [{project: PROJECT_ID, sessionCount: 1, ids: [BOB]}],
			all: [{project: PROJECT_ID, sessionCount: 3, ids: [ALICE, BOB, CAROL]}],
		});
	});

	it("project sessions exclude archived by default", () => {
		const ids = (status?: "active" | "archived" | "all") =>
			listSessionsForProjectFromDb(db.index, PROJECT_ID, status ? {status} : {}).map((s) => s.id);

		expect({default: ids(), archived: ids("archived"), all: ids("all")}).toStrictEqual({
			default: [ALICE, CAROL],
			archived: [BOB],
			all: [ALICE, BOB, CAROL],
		});
	});

	it("sessions looked up by id exclude archived by default", () => {
		const ids = (status?: "active" | "archived" | "all") =>
			getSessionsByIds(db.index, [ALICE, BOB], status ? {status} : {})
				.map((s) => s.id)
				.sort();

		expect({default: ids(), all: ids("all")}).toStrictEqual({
			default: [ALICE],
			all: [ALICE, BOB],
		});
	});

	it("session summaries carry the archived flag", () => {
		expect({
			alice: buildSessionSummaryPayloadFromDb(db.index, ALICE, () => null)?.archived,
			bob: buildSessionSummaryPayloadFromDb(db.index, BOB, () => null)?.archived,
		}).toStrictEqual({alice: false, bob: true});
	});
});

describe("auto-unarchive", () => {
	function makeStore() {
		return {
			markSessionActive: () => {},
			markSessionEnded: () => {},
			setSessionState: () => {},
			touchSession: () => {},
			touchSubagentActivity: () => {},
			setBackgroundTasks: () => {},
			setSessionCrons: () => {},
			getActiveSessionEntry: (): ActiveSessionEntry | null => null,
		};
	}

	it("unarchives on a new UserPromptSubmit and broadcasts the unarchived summary", async () => {
		setSessionArchived(db.index, BOB, true, 5_000);
		const broadcasts: Broadcast[] = [];

		await dispatchHookEvent({
			event: {
				hook_event_name: "UserPromptSubmit",
				session_id: BOB,
				transcript_path: `/fixtures/${BOB}.jsonl`,
				cwd: "/fixtures",
				prompt: "keep going",
			},
			db: db.index,
			store: makeStore(),
			broadcast: (type, data) => broadcasts.push({type, data}),
			reportHerdrState: () => {},
		});

		const updates = broadcasts
			.filter((b) => b.type === DOMAIN_EVENTS.SESSION_UPDATED)
			.map((b) => {
				const session = b.data["session"] as {id: string; archived: boolean};
				return {id: session.id, archived: session.archived};
			});
		expect({rows: archivedRows(db), updates}).toStrictEqual({
			rows: [],
			updates: [{id: BOB, archived: false}],
		});
	});

	it("does not broadcast an update for a prompt on a session that was never archived", async () => {
		const broadcasts: Broadcast[] = [];

		await dispatchHookEvent({
			event: {
				hook_event_name: "UserPromptSubmit",
				session_id: ALICE,
				transcript_path: `/fixtures/${ALICE}.jsonl`,
				cwd: "/fixtures",
				prompt: "keep going",
			},
			db: db.index,
			store: makeStore(),
			broadcast: (type, data) => broadcasts.push({type, data}),
			reportHerdrState: () => {},
		});

		expect(broadcasts.filter((b) => b.type === DOMAIN_EVENTS.SESSION_UPDATED)).toStrictEqual([]);
	});
});

describe("PUT/DELETE /api/sessions/$id/archived", () => {
	async function loadHandlers(broadcasts: Broadcast[]) {
		vi.doMock("../src/lib/db", () => ({getDb: () => db}));
		vi.doMock("../src/lib/sse-broadcast", () => ({
			broadcastTyped: (type: string, data: Record<string, unknown>) => broadcasts.push({type, data}),
		}));
		const {Route} = await import("../src/routes/api/sessions.$id.archived");
		return (Route as unknown as {options: {server: {handlers: Record<string, ApiHandler>}}}).options.server
			.handlers;
	}

	function request(method: string, headers?: HeadersInit): Request {
		const url = `http://localhost/api/sessions/${BOB}/archived`;
		return new Request(url, headers ? {method, headers} : {method});
	}

	async function call(handler: ApiHandler, req: Request) {
		const response = await handler({params: {id: BOB}, request: req});
		return {status: response.status, body: await response.json()};
	}

	it("archives and unarchives idempotently and broadcasts each change", async () => {
		const broadcasts: Broadcast[] = [];
		const handlers = await loadHandlers(broadcasts);

		const responses = [await call(handlers["PUT"]!, request("PUT")), await call(handlers["PUT"]!, request("PUT"))];
		const rowsAfterPut = archivedRows(db).map((r) => r.sessionId);
		responses.push(
			await call(handlers["DELETE"]!, request("DELETE")),
			await call(handlers["DELETE"]!, request("DELETE")),
		);

		expect({
			responses,
			rowsAfterPut,
			rowsAfterDelete: archivedRows(db),
			broadcasts: broadcasts.map((b) => ({
				type: b.type,
				archived: (b.data["session"] as {archived: boolean}).archived,
			})),
		}).toStrictEqual({
			responses: [
				{status: 200, body: {archived: true}},
				{status: 200, body: {archived: true}},
				{status: 200, body: {archived: false}},
				{status: 200, body: {archived: false}},
			],
			rowsAfterPut: [BOB],
			rowsAfterDelete: [],
			broadcasts: [
				{type: DOMAIN_EVENTS.SESSION_UPDATED, archived: true},
				{type: DOMAIN_EVENTS.SESSION_UPDATED, archived: true},
				{type: DOMAIN_EVENTS.SESSION_UPDATED, archived: false},
				{type: DOMAIN_EVENTS.SESSION_UPDATED, archived: false},
			],
		});
	});

	it("rejects cross-site requests", async () => {
		const broadcasts: Broadcast[] = [];
		const handlers = await loadHandlers(broadcasts);

		const response = await call(handlers["PUT"]!, request("PUT", {Origin: "https://evil.example"}));

		expect({response, rows: archivedRows(db), broadcasts}).toStrictEqual({
			response: {status: 403, body: {error: "Forbidden"}},
			rows: [],
			broadcasts: [],
		});
	});
});

describe("GET list routes", () => {
	async function get(routeModule: string, path: string): Promise<unknown> {
		vi.doMock("../src/lib/db", () => ({getDb: () => db}));
		const {Route} = (await import(routeModule)) as {Route: unknown};
		const handlers = (Route as {options: {server: {handlers: Record<string, ApiHandler>}}}).options.server.handlers;
		const response = await handlers["GET"]!({
			params: {id: PROJECT_ID},
			request: new Request(`http://localhost${path}`),
		});
		return response.json();
	}

	beforeEach(() => {
		setSessionArchived(db.index, BOB, true, 5_000);
	});

	it("recent sessions honour the status query parameter", async () => {
		const ids = async (query: string) =>
			(
				(await get("../src/routes/api/sessions.recent", `/api/sessions/recent${query}`)) as {
					sessions: Array<{id: string; archived: boolean}>;
				}
			).sessions.map((s) => [s.id, s.archived]);

		expect({
			default: await ids(""),
			archived: await ids("?status=archived"),
			all: await ids("?status=all"),
		}).toStrictEqual({
			default: [
				[ALICE, false],
				[CAROL, false],
			],
			archived: [[BOB, true]],
			all: [
				[ALICE, false],
				[BOB, true],
				[CAROL, false],
			],
		});
	});

	it("grouped sessions honour the status query parameter", async () => {
		const ids = async (query: string) =>
			(
				(await get("../src/routes/api/sessions.grouped", `/api/sessions/grouped${query}`)) as Array<{
					sessions: Array<{id: string}>;
				}>
			).flatMap((g) => g.sessions.map((s) => s.id));

		expect({default: await ids(""), all: await ids("?status=all")}).toStrictEqual({
			default: [ALICE, CAROL],
			all: [ALICE, BOB, CAROL],
		});
	});

	it("project sessions honour the status query parameter", async () => {
		const ids = async (query: string) =>
			(
				(await get(
					"../src/routes/api/projects.$id.sessions",
					`/api/projects/${PROJECT_ID}/sessions${query}`,
				)) as Array<{id: string}>
			).map((s) => s.id);

		expect({default: await ids(""), all: await ids("?status=all")}).toStrictEqual({
			default: [ALICE, CAROL],
			all: [ALICE, BOB, CAROL],
		});
	});

	it("session lookup returns the requested ids and honours the status query parameter", async () => {
		const ids = async (query: string) =>
			(
				(await get(
					"../src/routes/api/sessions.lookup",
					`/api/sessions/lookup?ids=${[CAROL, BOB, "session-missing"].join(",")}${query}`,
				)) as Array<{id: string; archived: boolean}>
			).map((s) => [s.id, s.archived]);

		expect({default: await ids(""), all: await ids("&status=all")}).toStrictEqual({
			default: [[CAROL, false]],
			all: [
				[BOB, true],
				[CAROL, false],
			],
		});
	});
});

describe("GET /api/notifications", () => {
	it("hides notifications for archived sessions unless the status filter asks for them", async () => {
		setSessionArchived(db.index, BOB, true, 5_000);
		vi.doMock("../src/lib/db", () => ({getDb: () => db}));
		const store = await import("../src/lib/notifications-store");
		store.clearAllNotifications();
		for (const sessionId of [ALICE, BOB]) {
			store.addNotification(db.index, {
				sessionId,
				cwd: "/fixtures",
				message: `Message ${sessionId}`,
				notificationType: "agent_needs_input",
			});
		}
		const {Route} = await import("../src/routes/api/notifications");
		const handlers = (Route as unknown as {options: {server: {handlers: Record<string, ApiHandler>}}}).options
			.server.handlers;
		const sessionIds = async (query: string) => {
			const response = await handlers["GET"]!({
				params: {id: ""},
				request: new Request(`http://localhost/api/notifications${query}`),
			});
			const body = (await response.json()) as {notifications: Array<{sessionId: string}>};
			return body.notifications.map((n) => n.sessionId).sort();
		};

		const result = {
			default: await sessionIds(""),
			archived: await sessionIds("?status=archived"),
			all: await sessionIds("?status=all"),
		};
		store.clearAllNotifications();

		expect(result).toStrictEqual({default: [ALICE], archived: [BOB], all: [ALICE, BOB]});
	});
});

describe("attention", () => {
	const enabled = {notifyCompletions: true, notifyPermissionRequests: true};

	it("the attention badge skips archived sessions", () => {
		expect(
			countSessionsNeedingAttention(
				[
					{sessionId: ALICE, displayState: "waiting", archived: false},
					{sessionId: BOB, displayState: "review", archived: true},
				],
				enabled,
				true,
				null,
			),
		).toBe(1);
	});

	it("desktop notifications skip archived sessions", () => {
		expect({
			archived: shouldNotify(enabled, "review", true, "granted", BOB, null, true),
			active: shouldNotify(enabled, "waiting", true, "granted", ALICE, null, false),
		}).toStrictEqual({archived: false, active: true});
	});
});

describe("durability", () => {
	it("keeps archived sessions across a reopen at the same schema version", () => {
		const cacheDir = mkdtempSync(join(tmpdir(), "archived-sessions-test-"));
		tempDirs.push(cacheDir);
		const original = openAppDb({cacheDir});
		setSessionArchived(original.index, BOB, true, 5_000);
		original.close();

		const reopened = openAppDb({cacheDir});
		const rows = archivedRows(reopened);
		reopened.close();

		expect(rows).toStrictEqual([{sessionId: BOB, archivedAt: 5_000}]);
	});
});
