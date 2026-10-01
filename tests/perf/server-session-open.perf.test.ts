import {afterAll, beforeAll, describe, it, vi} from "vite-plus/test";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {eq} from "drizzle-orm";
import type {AppDb} from "../../src/lib/db/connection";
import type {PerfCounters} from "../../src/lib/perf/server-scope";
import {generateTranscript, perfShapes, seedFixtureDb} from "./fixtures/generate-transcript";
import {ratchet} from "./ratchet";

/**
 * Server lab benchmark for opening a session (measurement plan §2.4 L1, §4.2). Calls the GET handlers behind the
 * session page directly against a seeded fixture DB and ratchets what each one costs per fixture shape.
 */

type ApiHandler = (context: {params: {id: string}; request: Request}) => Response | Promise<Response>;

const PROJECT = "-repo";

const ENDPOINTS = {
	detail: {module: "../../src/routes/api/sessions.$id", path: ""},
	transcript: {module: "../../src/routes/api/sessions.$id.transcript", path: "/transcript"},
	subagents: {module: "../../src/routes/api/sessions.$id.subagents", path: "/subagents"},
} as const;

type EndpointName = keyof typeof ENDPOINTS;

let root: string;
let db: AppDb;
let serverScope: typeof import("../../src/lib/perf/server-scope");
const handlers = new Map<EndpointName, ApiHandler>();

function git(cwd: string, ...args: string[]): void {
	execFileSync(
		"git",
		[
			"-c",
			"user.name=perf",
			"-c",
			"user.email=perf@example.com",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			...args,
		],
		{cwd, stdio: "ignore"},
	);
}

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "perf-session-open-"));
	const home = join(root, "home");
	const repo = join(root, "repo");
	mkdirSync(join(home, ".claude", "projects", PROJECT), {recursive: true});
	mkdirSync(repo);
	git(repo, "init", "--quiet");
	git(repo, "commit", "--quiet", "--allow-empty", "--message", "fixture");
	vi.stubEnv("HOME", home);
	vi.stubEnv("XDG_CONFIG_HOME", join(root, "config"));

	// Load the routes and the scope as one module graph, so the handlers report into the scope this test opens.
	vi.resetModules();
	const {openTestDb} = await import("../../src/lib/db/connection");
	db = openTestDb();
	vi.doMock("../../src/lib/db", () => ({getDb: () => db}));
	serverScope = await import("../../src/lib/perf/server-scope");
	for (const [name, {module}] of Object.entries(ENDPOINTS) as [EndpointName, (typeof ENDPOINTS)[EndpointName]][]) {
		const {Route} = (await import(module)) as {Route: unknown};
		const routeHandlers = (Route as {options: {server: {handlers: Record<string, ApiHandler>}}}).options.server
			.handlers;
		handlers.set(name, routeHandlers["GET"]!);
	}

	const files: string[] = [];
	for (const shape of perfShapes()) {
		const cached = await generateTranscript(shape);
		const file = join(home, ".claude", "projects", PROJECT, basename(cached));
		symlinkSync(cached, file);
		files.push(file);
	}
	await seedFixtureDb(db, files);
	const schema = await import("../../src/lib/db/schema");
	db.index.update(schema.projects).set({projectPath: repo}).where(eq(schema.projects.id, PROJECT)).run();
}, 600_000);

afterAll(() => {
	db.close();
	rmSync(root, {recursive: true, force: true});
	vi.doUnmock("../../src/lib/db");
	vi.unstubAllEnvs();
	vi.resetModules();
});

async function open(
	endpoint: EndpointName,
	sessionId: string,
): Promise<{counters: PerfCounters; responseBytes: number}> {
	const handler = handlers.get(endpoint)!;
	return serverScope.withPerfScope(`session-open-${endpoint}`, async () => {
		const response = await handler({
			params: {id: sessionId},
			request: new Request(`http://localhost/api/sessions/${sessionId}${ENDPOINTS[endpoint].path}`),
		});
		const body = await response.text();
		// The detail response carries the temp HOME and repo paths; drop them so the size is the same on every machine.
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

describe("server lab: opening a session", () => {
	for (const shape of perfShapes()) {
		for (const endpoint of Object.keys(ENDPOINTS) as EndpointName[]) {
			it(`${shape.name} ${endpoint}`, async () => {
				const sessionId = basename(await generateTranscript(shape), ".jsonl");
				const {counters, responseBytes} = await open(endpoint, sessionId);
				const prefix = `server.sessionOpen.${shape.name}.${endpoint}`;
				ratchetAll({
					[`${prefix}.sql.count`]: counters.sql.count,
					[`${prefix}.jsonl.bytesRead`]: counters.jsonl.bytesRead,
					[`${prefix}.jsonl.fullScans`]: counters.jsonl.fullScans,
					[`${prefix}.proc.spawned`]: counters.proc.spawned,
					[`${prefix}.resp.bytes`]: responseBytes,
				});
			});
		}
	}
});
