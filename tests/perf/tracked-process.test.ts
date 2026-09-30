import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../../src/lib/db/connection";
import * as schema from "../../src/lib/db/schema";
import {currentPerfCounters, withPerfScope} from "../../src/lib/perf/server-scope";
import {trackedExecFile} from "../../src/lib/perf/tracked-process";

type ApiHandler = (context: {params: {id: string}; request: Request}) => Response | Promise<Response>;

const SESSION_ID = "0b6f2b4e-2222-4222-8333-944455556666";
const PROJECT_ID = "-tmp-tracked-process-project";

let tempDir: string;
let repoDir: string;
let db: AppDb;
let originalHome: string | undefined;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "tracked-process-test-"));
	repoDir = join(tempDir, "repo");
	mkdirSync(repoDir);
	const git = (...args: string[]): void => {
		execFileSync("git", args, {cwd: repoDir, stdio: "pipe"});
	};
	git("init", "--quiet");
	writeFileSync(join(repoDir, "README.md"), "hello\n");
	git("add", "README.md");
	git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "--message", "init");
	db = openTestDb();
	originalHome = process.env["HOME"];
	process.env["HOME"] = tempDir;
});

afterEach(() => {
	if (originalHome === undefined) delete process.env["HOME"];
	else process.env["HOME"] = originalHome;
	db.close();
	rmSync(tempDir, {recursive: true, force: true});
	vi.doUnmock("../../src/lib/db");
	vi.resetModules();
});

async function getSessionDetail(sessionId: string): Promise<Response> {
	vi.doMock("../../src/lib/db", () => ({getDb: () => db}));
	const {Route} = await import("../../src/routes/api/sessions.$id");
	const handlers = (Route as unknown as {options: {server: {handlers: Record<string, ApiHandler>}}}).options.server
		.handlers;
	return handlers["GET"]!({
		params: {id: sessionId},
		request: new Request(`http://localhost/api/sessions/${sessionId}`),
	});
}

describe("trackedExecFile", () => {
	it("counts one spawn per call inside a perf scope", async () => {
		const result = await withPerfScope("test", async () => {
			const output = await trackedExecFile("git", ["rev-parse", "--short", "HEAD"], {cwd: repoDir});
			return {output: output.trim().length > 0, spawned: currentPerfCounters()?.proc.spawned};
		});
		expect(result).toStrictEqual({output: true, spawned: 1});
	});

	it("runs without a perf scope", async () => {
		const output = await trackedExecFile("git", ["status", "--porcelain"], {cwd: repoDir});
		expect(output).toBe("");
	});

	it("does not block the event loop while the command runs", async () => {
		let ticks = 0;
		const timer = setInterval(() => ticks++, 1);
		await trackedExecFile(process.execPath, ["-e", "setTimeout(() => {}, 200)"], {cwd: repoDir});
		clearInterval(timer);
		expect(ticks > 10).toBe(true);
	});

	it("rejects when the command fails", async () => {
		const error = await trackedExecFile("git", ["rev-parse", "HEAD"], {cwd: tempDir}).catch((err: unknown) => err);
		expect(error instanceof Error).toBe(true);
	});
});

describe("GET /api/sessions/$id", () => {
	it("spawns git rev-parse and git status once each", async () => {
		db.index
			.insert(schema.projects)
			.values({id: PROJECT_ID, name: "repo", projectPath: repoDir, updatedAt: 0})
			.run();
		db.index
			.insert(schema.sessions)
			.values({
				id: SESSION_ID,
				projectId: PROJECT_ID,
				title: "tracked process",
				createdAt: 0,
				mtimeMs: 0,
				filePath: join(tempDir, `${SESSION_ID}.jsonl`),
			})
			.run();

		// The route's dynamic imports resolve against the module registry that `vi.resetModules` refreshes,
		// so the scope has to come from that same registry to share its AsyncLocalStorage.
		const scope = await import("../../src/lib/perf/server-scope");
		const {spawned, body} = await scope.withPerfScope("detail", async () => {
			const response = await getSessionDetail(SESSION_ID);
			const json = (await response.json()) as {gitClean: boolean | null; gitSha: string | null};
			return {
				spawned: scope.currentPerfCounters()?.proc.spawned,
				body: {gitClean: json.gitClean, hasSha: json.gitSha !== null},
			};
		});

		expect({spawned, body}).toStrictEqual({spawned: 2, body: {gitClean: true, hasSha: true}});
	});
});
