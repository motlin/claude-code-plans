import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {Route} from "../src/routes/api/sessions.$id";

/**
 * `/api/sessions/$id` while the first full index is still running. A session
 * whose JSONL is on disk but not indexed yet is pending, not missing; an id
 * with no transcript anywhere is still `null` once indexing finishes.
 */

type ApiHandler = (context: {params: {id: string}}) => Response | Promise<Response>;

// The route's module graph loads once, at file import, where no test or hook timeout applies: a cold import on a
// loaded machine can take longer than a whole test's budget. Each test swaps the database and indexing flag instead.
const state = vi.hoisted(() => ({home: "", db: undefined as AppDb | undefined, indexing: false}));

vi.mock("node:os", async () => {
	const os = await vi.importActual<typeof import("node:os")>("node:os");
	state.home = `${os.tmpdir()}/claude-session-detail-indexing-${process.pid}`;
	const homedir = (): string => state.home;
	return {...os, homedir, default: {...os, homedir}};
});
vi.mock("../src/lib/db", () => ({getDb: () => state.db}));
vi.mock("../src/lib/db/indexer", async () => ({
	...(await vi.importActual<typeof import("../src/lib/db/indexer")>("../src/lib/db/indexer")),
	isCurrentlyIndexing: () => state.indexing,
}));

const projectId = "-Users-alice-projects-workflowy";
const sessionId = "6f1d2c3b-4a5e-4f60-9a1b-2c3d4e5f6a7b";

if (state.home === "") throw new Error("node:os was not mocked before the route loaded");

let db: AppDb;

beforeEach(() => {
	db = openTestDb();
	state.db = db;
	const projectDir = join(state.home, ".claude", "projects", projectId);
	mkdirSync(projectDir, {recursive: true});
	writeFileSync(
		join(projectDir, `${sessionId}.jsonl`),
		JSON.stringify({
			type: "user",
			uuid: "u1",
			sessionId,
			cwd: "/Users/alice/projects/workflowy",
			timestamp: "2026-10-31T12:00:00.000Z",
			message: {role: "user", content: "Fix the flaky sync test"},
		}) + "\n",
	);
});

afterEach(() => {
	db.close();
	rmSync(state.home, {recursive: true, force: true});
});

async function getDetail(id: string, indexing: boolean): Promise<unknown> {
	state.indexing = indexing;
	const handlers = (Route as unknown as {options: {server: {handlers: Record<string, ApiHandler>}}}).options.server
		.handlers;
	const response = await handlers["GET"]!({params: {id}});
	return response.json();
}
describe("GET /api/sessions/$id during the first index build", () => {
	it("finds a session whose transcript is on disk but not indexed yet", async () => {
		const body = (await getDetail(sessionId, true)) as {title: string; projectId: string} | null;

		expect(body === null ? null : {title: body.title, projectId: body.projectId}).toStrictEqual({
			title: "Fix the flaky sync test",
			projectId,
		});
	});

	it("still reports an unknown id as not found once indexing is done", async () => {
		expect(await getDetail("0a0b0c0d-1e1f-4a2b-8c3d-4e5f6a7b8c9d", false)).toStrictEqual(null);
	});

	it("reports an unknown id as not found while indexing when no transcript exists", async () => {
		expect(await getDetail("0a0b0c0d-1e1f-4a2b-8c3d-4e5f6a7b8c9d", true)).toStrictEqual(null);
	});
});
