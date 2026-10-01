import {afterAll, beforeAll, describe, it, vi} from "vite-plus/test";
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {AppDb} from "../../src/lib/db/connection";
import type {PerfCounters} from "../../src/lib/perf/server-scope";
import {PERF_SHAPES, generateTranscript} from "./fixtures/generate-transcript";
import {ratchet} from "./ratchet";

/**
 * Server lab benchmark for a cold load (measurement plan §2.4 L2 and L4). Calls the GET handlers behind the root
 * loader and the home page, plus `/api/search` for fixed queries, directly against a fixture DB seeded with small
 * generated sessions across several projects, and ratchets the SQL statements and response bytes each one costs.
 */

type ApiHandler = (context: {params: Record<string, string>; request: Request}) => Response | Promise<Response>;

const PROJECTS = ["-perf-alpha", "-perf-bravo", "-perf-charlie", "-perf-delta", "-perf-echo", "-perf-foxtrot"];
const SESSION_COUNT = 40;
/** Fixed file mtimes, far enough in the past that no fixture session counts as active. */
const MTIME_BASE_MS = Date.UTC(2026, 0, 2);

const ENDPOINTS = {
	projects: "projects",
	plans: "plans",
	sessionsRecent: "sessions.recent",
	sessionsGrouped: "sessions.grouped",
	sessionsActive: "sessions.active",
	approvals: "approvals",
	notifications: "notifications",
	plugins: "plugins",
	homeStats: "home-stats",
	composerDefaults: "composer-defaults",
	promptHistory: "prompt-history",
} as const;

type EndpointName = keyof typeof ENDPOINTS;

const SEARCH_QUERIES = {
	word: "schema",
	phrase: "render stream",
	miss: "zebra",
} as const;

type SearchName = keyof typeof SEARCH_QUERIES;

let root: string;
let db: AppDb;
let serverScope: typeof import("../../src/lib/perf/server-scope");
const handlers = new Map<string, ApiHandler>();

async function loadGet(module: string): Promise<ApiHandler> {
	const {Route} = (await import(`../../src/routes/api/${module}.ts`)) as {Route: unknown};
	return (Route as {options: {server: {handlers: Record<string, ApiHandler>}}}).options.server.handlers["GET"]!;
}

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "perf-cold-load-"));
	const home = join(root, "home");
	const projectsDir = join(home, ".claude", "projects");
	for (const project of PROJECTS) mkdirSync(join(projectsDir, project), {recursive: true});
	vi.stubEnv("HOME", home);
	vi.stubEnv("XDG_CONFIG_HOME", join(root, "config"));
	// Home stats bucket by local day and hour, so pin the zone to keep response bytes equal on every machine.
	vi.stubEnv("TZ", "UTC");

	// Load the routes and the scope as one module graph, so the handlers report into the scope this test opens.
	vi.resetModules();
	const {openTestDb} = await import("../../src/lib/db/connection");
	db = openTestDb();
	vi.doMock("../../src/lib/db", () => ({getDb: () => db}));
	serverScope = await import("../../src/lib/perf/server-scope");
	for (const module of [...Object.values(ENDPOINTS), "search"]) handlers.set(module, await loadGet(module));

	const {indexJsonlFile} = await import("../../src/lib/db/indexer");
	for (let seed = 1; seed <= SESSION_COUNT; seed++) {
		const project = PROJECTS[seed % PROJECTS.length]!;
		const cached = await generateTranscript(PERF_SHAPES.small, seed);
		const file = join(projectsDir, project, `small-${seed}.jsonl`);
		// Copies, not symlinks: the mtimes are set per file and must not touch the shared cache.
		copyFileSync(cached, file);
		const mtime = new Date(MTIME_BASE_MS + seed * 60_000);
		utimesSync(file, mtime, mtime);
		await indexJsonlFile(db.index, file, project);
	}
}, 600_000);

afterAll(() => {
	db.close();
	rmSync(root, {recursive: true, force: true});
	vi.doUnmock("../../src/lib/db");
	vi.unstubAllEnvs();
	vi.resetModules();
});

async function call(module: string, path: string): Promise<{counters: PerfCounters; responseBytes: number}> {
	const handler = handlers.get(module)!;
	return serverScope.withPerfScope(`cold-load-${module}`, async () => {
		const response = await handler({params: {}, request: new Request(`http://localhost${path}`)});
		const body = await response.text();
		if (!response.ok) throw new Error(`${path} returned ${response.status}: ${body}`);
		// Responses can carry the temp HOME; drop it so the size is the same on every machine.
		const responseBytes = Buffer.byteLength(body.replaceAll(root, ""));
		const counters = structuredClone(serverScope.currentPerfCounters()!);
		return {counters, responseBytes};
	});
}

/** Checks every count before failing, so one run records all of them in results.json for `just perf-ceilings`. */
function ratchetAll(values: Record<string, number>): void {
	const failures: string[] = [];
	for (const [id, value] of Object.entries(values)) {
		try {
			ratchet(id, value);
		} catch (error) {
			failures.push((error as Error).message);
		}
	}
	if (failures.length > 0) throw new Error(failures.join("\n"));
}

describe("server lab: cold load", () => {
	for (const [endpoint, module] of Object.entries(ENDPOINTS) as [EndpointName, string][]) {
		it(endpoint, async () => {
			const {counters, responseBytes} = await call(module, `/api/${module.replaceAll(".", "/")}`);
			ratchetAll({
				[`server.coldLoad.${endpoint}.resp.bytes`]: responseBytes,
				[`server.coldLoad.${endpoint}.sql.count`]: counters.sql.count,
			});
		});
	}
});

describe("server lab: search", () => {
	for (const [name, query] of Object.entries(SEARCH_QUERIES) as [SearchName, string][]) {
		it(name, async () => {
			const {counters} = await call("search", `/api/search?${new URLSearchParams({query}).toString()}`);
			ratchetAll({[`server.search.${name}.sql.count`]: counters.sql.count});
		});
	}
});
