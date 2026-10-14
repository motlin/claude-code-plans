import {describe, expect, it, vi, beforeEach, afterEach} from "vite-plus/test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {jsonlRecordFixtures} from "./fixtures/jsonl-records";

/**
 * Tests for `/api/sessions/$id/api-requests`: the whole session's API request
 * log, which an assistant turn's Request disclosure resolves its requestRef in.
 */

type ApiHandler = (context: {params: {id: string}}) => Response | Promise<Response>;

let tempDir: string;
let db: AppDb;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "api-session-api-requests-test-"));
	db = openTestDb();
});

afterEach(() => {
	db.close();
	rmSync(tempDir, {recursive: true, force: true});
	vi.doUnmock("../src/lib/db");
	vi.resetModules();
});

async function getApiRequests(sessionId: string): Promise<unknown> {
	vi.doMock("../src/lib/db", () => ({getDb: () => db}));
	const {Route} = await import("../src/routes/api/sessions.$id.api-requests");
	const handlers = (Route as unknown as {options: {server: {handlers: Record<string, ApiHandler>}}}).options.server
		.handlers;
	return (await handlers["GET"]!({params: {id: sessionId}})).json();
}

function seedSession(sessionId: string, lines: string[]): void {
	const filePath = join(tempDir, `${sessionId}.jsonl`);
	writeFileSync(filePath, lines.join("\n") + "\n");
	db.index
		.insert(schema.sessions)
		.values({id: sessionId, projectId: "test-project", title: sessionId, createdAt: 0, mtimeMs: 0, filePath})
		.run();
}

describe("GET /api/sessions/$id/api-requests", () => {
	it("serves the request log scanned from the whole JSONL", async () => {
		seedSession("s", [
			JSON.stringify(jsonlRecordFixtures["api-request-shape"]),
			"{not json",
			JSON.stringify(jsonlRecordFixtures["api-request-blob"]),
			JSON.stringify(jsonlRecordFixtures["api-request"]),
		]);
		expect(await getApiRequests("s")).toStrictEqual({
			requests: {
				"request-alice-100": {
					id: "request-alice-100",
					timestamp: "2000-01-01T00:00:00.000Z",
					querySource: "repl_main_thread",
					shapeHash: "shape-alice-100",
					model: "test-model",
					betas: ["test-beta"],
					maxTokens: 100,
					thinking: {type: "adaptive", display: "updates"},
					effort: "medium",
					permissionMode: "auto",
				},
			},
			shapes: {"shape-alice-100": {shapeHash: "shape-alice-100", system: ["You are a test."], tools: ["Read"]}},
		});
	});

	it("serves an empty log for a session that logged no requests", async () => {
		seedSession("old", [JSON.stringify({type: "user", message: {role: "user", content: "hi"}})]);
		expect(await getApiRequests("old")).toStrictEqual({requests: {}, shapes: {}});
	});

	it("serves an empty log for an unknown session", async () => {
		expect(await getApiRequests("missing")).toStrictEqual({requests: {}, shapes: {}});
	});
});
