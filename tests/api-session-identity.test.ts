import {mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {eq} from "drizzle-orm";
import Database from "better-sqlite3";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {fullScan, indexJsonlFile} from "../src/lib/db/indexer";
import * as schema from "../src/lib/db/schema";
import * as sessionFiles from "../src/lib/sessions";
import {currentPerfCounters, withPerfScope} from "../src/lib/perf/server-scope";
import {Route as IdentityRoute} from "../src/routes/api/sessions.$id.identity";
import {Route as DetailRoute} from "../src/routes/api/sessions.$id";
import {Route as RecentRoute} from "../src/routes/api/sessions.recent";
import {herdrPaneTables} from "../src/lib/herdr/pane-table";
import {tmuxPaneTable} from "../src/lib/tmux/pane-table";

const PROJECT = "-example-project";
const ALICE = "session-alice";
const BOB = "session-bob";
const CAROL = "session-carol";
let db: AppDb;
let directory: string;
let projectsDirectory: string;
let modificationTime: number;
let indexing: boolean;

vi.mock("../src/lib/db", () => ({getDb: () => db}));
vi.mock("../src/lib/db/indexer", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/lib/db/indexer")>()),
	isCurrentlyIndexing: () => indexing,
}));

type ApiHandler = (context: {params: {id: string}}) => Response | Promise<Response>;

async function get(route: unknown, id: string): Promise<Response> {
	const {handlers} = (route as {options: {server: {handlers: Record<string, ApiHandler>}}}).options.server;
	return Promise.resolve(handlers["GET"]!({params: {id}}));
}

async function identity(id: string) {
	const response = await get(IdentityRoute, id);
	return {
		status: response.status,
		body: (await response.json()) as unknown,
		retryAfter: response.headers.get("Retry-After"),
	};
}

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "session-identity-test-"));
	projectsDirectory = join(directory, ".claude", "projects");
	mkdirSync(join(projectsDirectory, PROJECT), {recursive: true});
	vi.stubEnv("HOME", directory);
	vi.stubEnv("XDG_CONFIG_HOME", join(directory, "config"));
	db = openTestDb();
	modificationTime = 946_684_800;
	indexing = false;
});

afterEach(() => {
	vi.restoreAllMocks();
	db.close();
	rmSync(directory, {recursive: true, force: true});
	vi.unstubAllEnvs();
});

function expectedDetail() {
	return {
		title: "Example prompt",
		projectName: "project",
		projectId: PROJECT,
		homeRoot: directory,
		imageRoots: [],
		archived: false,
		summary: null,
		projectPath: null,
		gitBranch: null,
		cwd: null,
		gitSha: null,
		gitClean: null,
		messageCount: 1,
		pendingTaskCount: 0,
		viewedState: {
			currentMessageIndex: 0,
			lastViewedMessageIndex: -1,
			newMessageCount: 1,
			reviewTargetMessageIndex: -1,
			viewedAnywhere: true,
			viewedInCcp: true,
			viewedInHerdr: false,
		},
	};
}

async function indexSession(sessionId: string, bridgeIds: string[]): Promise<string> {
	const path = join(projectsDirectory, PROJECT, `${sessionId}.jsonl`);
	const records = [
		{type: "user", sessionId, message: {role: "user", content: "Example prompt"}},
		...bridgeIds.map((bridgeSessionId) => ({
			type: "bridge-session",
			sessionId,
			bridgeSessionId,
			lastSequenceNum: 0,
		})),
	];
	writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
	utimesSync(path, modificationTime, ++modificationTime);
	await indexJsonlFile(db.index, path, PROJECT);
	// Fixtures have no checkout; keep detail lookup independent of the host's Git state.
	db.index.update(schema.projects).set({projectPath: null}).where(eq(schema.projects.id, PROJECT)).run();
	return path;
}

describe("session detail API titles", () => {
	it("returns the CLI's AI title beside a /rename title", async () => {
		const path = join(projectsDirectory, PROJECT, `${ALICE}.jsonl`);
		const records = [
			{type: "user", sessionId: ALICE, message: {role: "user", content: "Example prompt"}},
			{type: "custom-title", customTitle: "claude.ai", sessionId: ALICE},
			{type: "ai-title", aiTitle: "Parallel do-task workstreams", sessionId: ALICE},
		];
		writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
		await indexJsonlFile(db.index, path, PROJECT);
		db.index.update(schema.projects).set({projectPath: null}).where(eq(schema.projects.id, PROJECT)).run();

		const detail = await (await get(DetailRoute, ALICE)).json();

		expect(detail).toStrictEqual({
			...expectedDetail(),
			title: "claude.ai",
			aiTitle: "Parallel do-task workstreams",
		});
	});
});

describe("recent sessions API Remote Control flag", () => {
	it("marks only a session bridged to claude.ai as Remote Control", async () => {
		await indexSession(ALICE, ["cse_alice_100"]);
		await indexSession(BOB, []);
		const {handlers} = (
			RecentRoute as unknown as {
				options: {server: {handlers: Record<string, (context: {request: Request}) => Promise<Response>>}};
			}
		).options.server;

		const response = await handlers["GET"]!({request: new Request("http://localhost/api/sessions/recent")});
		const {sessions} = (await response.json()) as {sessions: Array<{id: string; remoteControl?: true}>};

		expect(sessions.map(({id, remoteControl}) => ({id, remoteControl}))).toStrictEqual([
			{id: BOB, remoteControl: undefined},
			{id: ALICE, remoteControl: true},
		]);
	});
});

describe("recent sessions API terminal host", () => {
	afterEach(() => {
		herdrPaneTables.remove("/tmp/herdr-test.sock");
		tmuxPaneTable.invalidate();
	});

	it("labels each row by the herdr or tmux pane it runs in, read from the pane tables, and omits it for Local", async () => {
		await indexSession(ALICE, []);
		await indexSession(BOB, []);
		await indexSession(CAROL, []);
		herdrPaneTables.forServer("/tmp/herdr-test.sock").seed({
			workspaces: [],
			panes: [
				{
					pane_id: "wM:p1@later",
					terminal_id: "terminal-alice",
					workspace_id: "wM@later",
					tab_id: "wM:t1@later",
					focused: false,
					agent_status: "idle",
					revision: 1,
					agent_session: {source: "test", agent: "claude", kind: "id", value: ALICE},
				},
			],
		});
		tmuxPaneTable.hold([
			{
				sessionId: BOB,
				cwd: "/repo",
				via: "env",
				pane: {
					paneId: "%7",
					panePid: 700,
					socketPath: "/tmp/tmux-test/default",
					sessionName: "work",
					windowIndex: 0,
					windowName: "claude",
					windowActive: true,
					paneActive: true,
					currentPath: "/repo",
				},
			},
		]);
		const {handlers} = (
			RecentRoute as unknown as {
				options: {server: {handlers: Record<string, (context: {request: Request}) => Promise<Response>>}};
			}
		).options.server;

		const response = await handlers["GET"]!({request: new Request("http://localhost/api/sessions/recent")});
		const {sessions} = (await response.json()) as {sessions: Array<{id: string; terminalHost?: string}>};

		expect(sessions.map(({id, terminalHost}) => ({id, terminalHost}))).toStrictEqual([
			{id: CAROL, terminalHost: undefined},
			{id: BOB, terminalHost: "tmux · work"},
			{id: ALICE, terminalHost: "herdr · later"},
		]);
	});
});

describe("indexed session identity API", () => {
	it("resolves historical aliases without reading transcript files and returns the latest canonical detail ID", async () => {
		await indexSession(ALICE, ["cse_alice_100", "session_alice_200"]);
		const actual = await withPerfScope("session-identity", async () => {
			const results = [await identity("session_alice_100"), await identity("session_alice_200")];
			const counters = currentPerfCounters()!;
			return {results, sql: counters.sql.count, jsonl: counters.jsonl, processes: counters.proc.spawned};
		});
		expect(actual).toStrictEqual({
			results: [
				{status: 200, body: {sessionId: ALICE}, retryAfter: null},
				{status: 200, body: {sessionId: ALICE}, retryAfter: null},
			],
			sql: 2,
			jsonl: {bytesRead: 0, fullScans: 0},
			processes: 0,
		});
		const detail = await (await get(DetailRoute, ALICE)).json();
		expect(detail).toStrictEqual({...expectedDetail(), canonicalRouteId: "session_alice_200"});
	});

	it("rejects ambiguous aliases while keeping each UUID detail and restores uniqueness after pruning", async () => {
		await indexSession(ALICE, ["cse_alice_100"]);
		const bobPath = await indexSession(BOB, ["cse_alice_100"]);
		indexing = true;
		const ambiguous = await identity("session_alice_100");
		const before = await (await get(DetailRoute, ALICE)).json();
		rmSync(bobPath);
		await fullScan(db.index, db.summaries, projectsDirectory);
		const after = await (await get(DetailRoute, ALICE)).json();
		expect({ambiguous, before, after, resolved: await identity("session_alice_100")}).toStrictEqual({
			ambiguous: {status: 409, body: {error: "Session alias has multiple local owners"}, retryAfter: null},
			before: expectedDetail(),
			after: {...expectedDetail(), canonicalRouteId: "session_alice_100"},
			resolved: {status: 200, body: {sessionId: ALICE}, retryAfter: null},
		});
	});

	it("ignores stale owners and never canonicalizes another surviving owner's alias", async () => {
		await indexSession(ALICE, ["cse_alice_100"]);
		await indexSession(BOB, ["cse_alice_100"]);
		db.index.delete(schema.sessions).where(eq(schema.sessions.id, BOB)).run();
		const found = await identity("session_alice_100");
		const unique = await (await get(DetailRoute, ALICE)).json();
		await indexSession(BOB, ["cse_bob_100"]);
		db.index
			.update(schema.metadata)
			.set({value: JSON.stringify([BOB])})
			.where(eq(schema.metadata.key, "bridge:v1:alias:session_alice_100"))
			.run();
		const otherOwner = await identity("session_alice_100");
		const stale = await (await get(DetailRoute, ALICE)).json();
		db.index.delete(schema.sessions).where(eq(schema.sessions.id, BOB)).run();
		expect({found, unique, otherOwner, stale, missing: await identity("session_alice_100")}).toStrictEqual({
			found: {status: 200, body: {sessionId: ALICE}, retryAfter: null},
			unique: {...expectedDetail(), canonicalRouteId: "session_alice_100"},
			otherOwner: {status: 200, body: {sessionId: BOB}, retryAfter: null},
			stale: expectedDetail(),
			missing: {status: 404, body: {error: "Session alias not found"}, retryAfter: null},
		});
	});

	it("serves existing aliases during indexing and reports pending only for unresolved aliases", async () => {
		await indexSession(ALICE, ["cse_alice_100"]);
		indexing = true;
		const found = await identity("session_alice_100");
		const pending = await identity("session_bob_100");
		const invalid = await identity("cse_alice_100");
		indexing = false;
		expect({found, pending, invalid, missing: await identity("session_bob_100")}).toStrictEqual({
			found: {status: 200, body: {sessionId: ALICE}, retryAfter: null},
			pending: {status: 503, body: {error: "Session index is still loading"}, retryAfter: "3"},
			invalid: {status: 404, body: {error: "Session alias not found"}, retryAfter: null},
			missing: {status: 404, body: {error: "Session alias not found"}, retryAfter: null},
		});
	});

	it("returns missing for an alias removed by a transcript rewrite", async () => {
		await indexSession(ALICE, ["cse_alice_100"]);
		await indexSession(ALICE, []);
		expect(await identity("session_alice_100")).toStrictEqual({
			status: 404,
			body: {error: "Session alias not found"},
			retryAfter: null,
		});
	});

	it("adds canonical identity to UUID detail without another SQL statement or an empty response field", async () => {
		await indexSession(ALICE, []);
		const detail = async () =>
			withPerfScope("session-detail", async () => {
				const response = await get(DetailRoute, ALICE);
				return {
					body: (await response.json()) as Record<string, unknown>,
					sql: currentPerfCounters()!.sql.count,
				};
			});
		const plain = await detail();
		await indexSession(ALICE, ["cse_alice_100"]);
		const bridged = await detail();
		const {canonicalRouteId, ...remaining} = bridged.body;
		expect({plain, bridgedSql: bridged.sql, canonicalRouteId, remaining}).toStrictEqual({
			plain: {body: expectedDetail(), sql: 12},
			bridgedSql: 12,
			canonicalRouteId: "session_alice_100",
			remaining: expectedDetail(),
		});
	});

	it("looks up metadata and local owners by primary key in both query plans", async () => {
		await indexSession(ALICE, ["cse_alice_100"]);
		const client: unknown = Reflect.get(db.index, "$client");
		if (!(client instanceof Database)) throw new Error("Example index has no SQLite client");
		const prepare = vi.spyOn(client, "prepare");
		await identity("session_alice_100");
		await get(DetailRoute, ALICE);
		const queries = prepare.mock.calls.map(([query]) => query).filter((query) => query.includes("bridge_owner"));
		prepare.mockRestore();
		const plans = queries.map((query) => {
			const bindings = Array.from({length: query.match(/\?/g)?.length ?? 0}, () => null);
			return (client.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...bindings) as Array<{detail: string}>).map(
				({detail}) => detail,
			);
		});
		expect(plans).toStrictEqual([
			[
				"SEARCH metadata USING INDEX sqlite_autoindex_metadata_1 (key=?)",
				"SCAN bridge_owner VIRTUAL TABLE INDEX 1:",
				"SEARCH sessions USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)",
				"USE TEMP B-TREE FOR DISTINCT",
			],
			[
				"SEARCH sessions USING INDEX sqlite_autoindex_sessions_1 (id=?)",
				"CORRELATED SCALAR SUBQUERY 2",
				"SEARCH local_bridge USING INDEX sqlite_autoindex_metadata_1 (key=?)",
				"CORRELATED SCALAR SUBQUERY 1",
				"USE TEMP B-TREE FOR count(DISTINCT)",
				"SEARCH remote_bridge USING INDEX sqlite_autoindex_metadata_1 (key=?)",
				"SCAN bridge_owner VIRTUAL TABLE INDEX 1:",
				"SEARCH live_owner USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)",
				"SCALAR SUBQUERY 3",
				"SEARCH metadata USING COVERING INDEX sqlite_autoindex_metadata_1 (key=?)",
			],
		]);
	});
});

describe("detail alias backfill snapshot", () => {
	it("marks only absent forward metadata while indexing, including completed negative records", async () => {
		await indexSession(ALICE, []);
		indexing = true;
		const completedNegative = await (await get(DetailRoute, ALICE)).json();
		db.index
			.delete(schema.metadata)
			.where(eq(schema.metadata.key, `bridge:v1:local:${ALICE}`))
			.run();
		const pending = await (await get(DetailRoute, ALICE)).json();
		indexing = false;
		const ready = await (await get(DetailRoute, ALICE)).json();
		expect({completedNegative, pending, ready}).toStrictEqual({
			completedNegative: expectedDetail(),
			pending: {...expectedDetail(), canonicalRoutePending: true},
			ready: expectedDetail(),
		});
	});

	it("retains the pending snapshot when indexing finishes before a delayed detail response", async () => {
		await indexSession(ALICE, []);
		db.index
			.delete(schema.metadata)
			.where(eq(schema.metadata.key, `bridge:v1:local:${ALICE}`))
			.run();
		let entered!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let finish!: () => void;
		const pending = new Promise<null>((resolve) => {
			finish = () => {
				resolve(null);
			};
		});
		vi.spyOn(sessionFiles, "readSession").mockImplementationOnce(async () => {
			entered();
			return pending;
		});
		indexing = true;
		const response = get(DetailRoute, ALICE);
		await started;
		indexing = false;
		finish();
		expect(await (await response).json()).toStrictEqual({...expectedDetail(), canonicalRoutePending: true});
	});

	it("keeps the pending marker in the existing detail SQL statement", async () => {
		await indexSession(ALICE, []);
		db.index
			.delete(schema.metadata)
			.where(eq(schema.metadata.key, `bridge:v1:local:${ALICE}`))
			.run();
		indexing = true;
		const result = await withPerfScope("pending-detail", async () => ({
			body: await (await get(DetailRoute, ALICE)).json(),
			sql: currentPerfCounters()!.sql.count,
		}));
		expect(result).toStrictEqual({body: {...expectedDetail(), canonicalRoutePending: true}, sql: 12});
	});
});

describe("short session ID prefix identity", () => {
	const FIRST = "6473581f-86a0-44da-8043-86ef0a506b51";
	const SECOND = "6473581f-0000-4000-8000-000000000002";
	const OTHER = "4239b953-1111-4111-8111-111111111111";

	it("resolves a unique prefix to its full session ID and reports ambiguous, missing and pending prefixes", async () => {
		await indexSession(FIRST, []);
		await indexSession(OTHER, []);
		const unique = await identity("6473581f");
		const dashed = await identity("6473581f-86a0");
		const full = await identity(FIRST);
		await indexSession(SECOND, []);
		const ambiguous = await identity("6473581f");
		const longer = await identity("6473581f-86");
		const missing = await identity("deadbeef");
		indexing = true;
		const pending = await identity("deadbeef");
		expect({unique, dashed, full, ambiguous, longer, missing, pending}).toStrictEqual({
			unique: {status: 200, body: {sessionId: FIRST}, retryAfter: null},
			dashed: {status: 200, body: {sessionId: FIRST}, retryAfter: null},
			full: {status: 404, body: {error: "Session alias not found"}, retryAfter: null},
			ambiguous: {
				status: 409,
				body: {error: "Session alias has multiple local owners"},
				retryAfter: null,
			},
			longer: {status: 200, body: {sessionId: FIRST}, retryAfter: null},
			missing: {status: 404, body: {error: "Session alias not found"}, retryAfter: null},
			pending: {status: 503, body: {error: "Session index is still loading"}, retryAfter: "3"},
		});
	});
});
