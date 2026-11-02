import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../../src/lib/db/connection";
import * as schema from "../../src/lib/db/schema";
import {currentPerfCounters, withPerfScope} from "../../src/lib/perf/server-scope";
import {trackedExecFile} from "../../src/lib/perf/tracked-process";
import {Route} from "../../src/routes/api/sessions.$id";
import {runGit} from "../git-fixture";

type ApiHandler = (context: {
	params:
	{
		id: string;
	};
	request: Request;
}) => Response | Promise<Response>;

// The route's module graph loads once, at file import, where no test or hook timeout applies: a cold import on a
// loaded machine can outlast a test's budget. Each test swaps in its own database instead.
const state = vi.hoisted(() => (
{
	db: undefined as AppDb | undefined,
}));
vi.mock("../../src/lib/db", () => (
{
	getDb: () => state.db,
}));

const SESSION_ID = "0b6f2b4e-2222-4222-8333-944455556666";
const PROJECT_ID = "-tmp-tracked-process-project";

let tempDir: string;
let repoDir: string;
let db: AppDb;
let originalHome: string | undefined;

// No test writes to the repo, so the git fixture (three spawns) is built once for the file. Its hook gets a
// timeout sized for spawning git on a loaded machine rather than the 10s default.
beforeAll(() =>
{
	tempDir = mkdtempSync(join(tmpdir(), "tracked-process-test-"));
	repoDir = join(tempDir, "repo");
	mkdirSync(repoDir);
	const git = (...args: string[]): void =>
	{
		runGit(repoDir, args);
	};
	git("init", "--quiet");
	writeFileSync(join(repoDir, "README.md"), "hello\n");
	git("add", "README.md");
	git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "--message", "init");
	originalHome = process.env["HOME"];
	process.env["HOME"] = tempDir;
}, 60_000);

afterAll(() =>
{
	if (originalHome === undefined) delete process.env["HOME"];
	else process.env["HOME"] = originalHome;
	rmSync(
		tempDir,
		{
			recursive: true,
			force: true,
		},
	);
});

beforeEach(() =>
{
	db = openTestDb();
	state.db = db;
});

afterEach(() =>
{
	db.close();
});

async function getSessionDetail(sessionId: string): Promise<Response>
{
	const handlers = (
		Route as unknown as
		{
			options:
			{
				server:
				{
					handlers: Record<string, ApiHandler>;
				};
			};
		}
	).options.server.handlers;
	return handlers["GET"]!(
		{
			params:
			{
				id: sessionId,
			},
			request: new Request(`http://localhost/api/sessions/${sessionId}`),
		},
	);
}

describe("trackedExecFile", () =>
{
	it("counts one spawn per call inside a perf scope", async () =>
	{
		const result = await withPerfScope("test", async () =>
		{
			const output = await trackedExecFile(
				"git",
				["rev-parse", "--short", "HEAD"],
				{
					cwd: repoDir,
				},
			);
			return {
				output: output.trim().length > 0,
				spawned: currentPerfCounters()?.proc.spawned,
			};
		});
		expect(result).toStrictEqual(
			{
				output: true,
				spawned: 1,
			},
		);
	});

	it("runs without a perf scope", async () =>
	{
		const output = await trackedExecFile(
			"git",
			["status", "--porcelain"],
			{
				cwd: repoDir,
			},
		);
		expect(output).toBe("");
	});

	it("does not block the event loop while the command runs", async () =>
	{
		let ticks = 0;
		const timer = setInterval(() => ticks++, 1);
		await trackedExecFile(
			process.execPath,
			["-e", "setTimeout(() => {}, 200)"],
			{
				cwd: repoDir,
			},
		);
		clearInterval(timer);
		expect(ticks > 10).toBe(true);
	});

	it("rejects when the command fails", async () =>
	{
		const error = await trackedExecFile(
			"git",
			["rev-parse", "HEAD"],
			{
				cwd: tempDir,
			},
		).catch((err: unknown) => err);
		expect(error instanceof Error).toBe(true);
	});
});

describe("GET /api/sessions/$id", () =>
{
	it("spawns git rev-parse and git status once each", async () =>
	{
		db.index
			.insert(schema.projects)
			.values(
				{
					id: PROJECT_ID,
					name: "repo",
					projectPath: repoDir,
					updatedAt: 0,
				},
			)
			.run();
		db.index
			.insert(schema.sessions)
			.values(
				{
					id: SESSION_ID,
					projectId: PROJECT_ID,
					title: "tracked process",
					createdAt: 0,
					mtimeMs: 0,
					filePath: join(tempDir, `${SESSION_ID}.jsonl`),
				},
			)
			.run();

		const {spawned, body} = await withPerfScope("detail", async () =>
		{
			const response = await getSessionDetail(SESSION_ID);
			const json = (await response.json()) as
			{
				gitClean: boolean | null;
				gitSha: string | null;
			};
			return {
				spawned: currentPerfCounters()?.proc.spawned,
				body:
				{
					gitClean: json.gitClean,
					hasSha: json.gitSha !== null,
				},
			};
		});

		expect(
			{
				spawned,
				body,
			},
		).toStrictEqual(
			{
				spawned: 2,
				body:
				{
					gitClean: true,
					hasSha: true,
				},
			},
		);
	});
});
