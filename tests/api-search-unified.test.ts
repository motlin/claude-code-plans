import {sql} from "drizzle-orm";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {UnifiedSearchResponse, type UnifiedSearchItem} from "../src/lib/api/search";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {handleUnifiedSearchRequest} from "../src/routes/api/search";

const NOW = new Date(2026, 8, 15, 12, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("unified search API", () => {
	let db: AppDb;

	beforeEach(() => {
		db = openTestDb();
		db.index
			.insert(schema.projects)
			.values([
				{id: "proj-a", name: "Alpha", projectPath: "/projects/alpha", updatedAt: 1},
				{id: "proj-b", name: "Beta", projectPath: "/projects/beta", updatedAt: 1},
			])
			.run();
	});

	afterEach(() => {
		db.close();
	});

	function seedSession(
		id: string,
		options: {title: string; projectId?: string; mtimeMs?: number; content?: string},
	): void {
		db.index
			.insert(schema.sessions)
			.values({
				id,
				projectId: options.projectId ?? "proj-a",
				title: options.title,
				messageCount: 1,
				isSidechain: 0,
				createdAt: 0,
				mtimeMs: options.mtimeMs ?? NOW - HOUR,
				filePath: `/sessions/${id}.jsonl`,
			})
			.run();
		if (options.content !== undefined) {
			db.index.run(sql`INSERT INTO message_content(session_id, content) VALUES (${id}, ${options.content})`);
		}
	}

	function seedFile(path: string, content: string, mtimeMs = NOW - HOUR): void {
		db.index.run(sql`INSERT INTO file_content(path, content) VALUES (${path}, ${content})`);
		db.index
			.insert(schema.indexedFiles)
			.values({path: `file-content:${path}`, mtimeMs, sizeBytes: content.length, indexedAt: 0})
			.run();
	}

	async function search(parameters: Record<string, string>): Promise<UnifiedSearchItem[]> {
		const response = request(parameters);
		expect(response.status).toBe(200);
		return UnifiedSearchResponse.parse(await response.json()).items;
	}

	function request(parameters: Record<string, string>): Response {
		const url = `http://localhost/api/search?${new URLSearchParams(parameters).toString()}`;
		return handleUnifiedSearchRequest(new Request(url), db.index, NOW);
	}

	it("returns no items for an empty query", async () => {
		seedSession("s-1", {title: "Fix login flow"});
		expect(await search({query: "  "})).toStrictEqual([]);
	});

	it("merges title and message hits, ranking title hits first and deduping sessions", async () => {
		seedSession("s-msg", {title: "Other work", content: "we discussed the login screen"});
		seedSession("s-title", {title: "Fix login flow"});
		seedSession("s-both", {title: "Login refactor", content: "the login code is messy"});

		const items = await search({query: "login"});

		expect(items.map((item) => item.id)).toHaveLength(3);
		expect(
			items
				.slice(0, 2)
				.map((item) => item.id)
				.sort(),
		).toStrictEqual(["s-both", "s-title"]);
		expect(items[2]).toStrictEqual({
			kind: "session",
			id: "s-msg",
			title: "Other work",
			titleMatches: [],
			snippet: {
				text: "we discussed the login screen",
				matches: [{start: 17, end: 22}],
			},
			projectId: "proj-a",
			projectName: "Alpha",
			mtime: new Date(NOW - HOUR).toISOString(),
		});
		const both = items.find((item) => item.id === "s-both");
		expect(both).toStrictEqual({
			kind: "session",
			id: "s-both",
			title: "Login refactor",
			titleMatches: [{start: 0, end: 5}],
			snippet: {text: "the login code is messy", matches: [{start: 4, end: 9}]},
			projectId: "proj-a",
			projectName: "Alpha",
			mtime: new Date(NOW - HOUR).toISOString(),
		});
	});

	it("reports UTF-16 offsets for multi-byte text", async () => {
		const title = "🚀 Déploiement 日本語 login";
		const content = "Ünïcödé 😀😀 text before the login keyword and 日本語 after";
		seedSession("s-multi", {title, content});

		const [item] = await search({query: "login"});

		const titleStart = title.indexOf("login");
		const contentStart = content.indexOf("login");
		expect(item).toStrictEqual({
			kind: "session",
			id: "s-multi",
			title,
			titleMatches: [{start: titleStart, end: titleStart + 5}],
			snippet: {text: content, matches: [{start: contentStart, end: contentStart + 5}]},
			projectId: "proj-a",
			projectName: "Alpha",
			mtime: new Date(NOW - HOUR).toISOString(),
		});
		expect(title.slice(titleStart, titleStart + 5)).toBe("login");
	});

	it("highlights every matched term in the title", async () => {
		seedSession("s-1", {title: "日本 deploy then deploy again"});

		const [item] = await search({query: "deploy"});

		expect(item?.titleMatches).toStrictEqual([
			{start: 3, end: 9},
			{start: 15, end: 21},
		]);
	});

	it("returns file hits with project attribution", async () => {
		seedFile("/projects/beta/src/login.ts", "export function login() {}");

		const items = await search({query: "login", type: "files"});

		expect(items).toStrictEqual([
			{
				kind: "file",
				id: "/projects/beta/src/login.ts",
				title: "src/login.ts",
				titleMatches: [{start: 4, end: 9}],
				snippet: {
					text: "export function login() {}",
					matches: [{start: 16, end: 21}],
				},
				projectId: "proj-b",
				projectName: "Beta",
				mtime: new Date(NOW - HOUR).toISOString(),
			},
		]);
	});

	it("filters by type", async () => {
		seedSession("s-1", {title: "login work"});
		seedFile("/projects/alpha/login.md", "login notes");

		expect((await search({query: "login"})).map((item) => item.kind)).toStrictEqual(["session", "file"]);
		expect((await search({query: "login", type: "sessions"})).map((item) => item.kind)).toStrictEqual(["session"]);
		expect((await search({query: "login", type: "files"})).map((item) => item.kind)).toStrictEqual(["file"]);
		expect(await search({query: "login", type: "plans"})).toStrictEqual([]);
		expect(await search({query: "login", type: "memories"})).toStrictEqual([]);
	});

	it("filters by project", async () => {
		seedSession("s-a", {title: "login alpha", projectId: "proj-a"});
		seedSession("s-b", {title: "other", projectId: "proj-b", content: "login beta"});
		seedFile("/projects/alpha/login.md", "login");
		seedFile("/projects/beta/login.md", "login");

		const items = await search({query: "login", project: "proj-b"});

		expect(items.map((item) => item.id)).toStrictEqual(["s-b", "/projects/beta/login.md"]);
	});

	it("filters by date", async () => {
		seedSession("s-hour", {title: "login hour", mtimeMs: NOW - HOUR});
		seedSession("s-3d", {title: "login three days", mtimeMs: NOW - 3 * DAY});
		seedSession("s-20d", {title: "login twenty days", mtimeMs: NOW - 20 * DAY});
		seedSession("s-60d", {title: "login sixty days", mtimeMs: NOW - 60 * DAY});

		const ids = async (date: string) => (await search({query: "login", date})).map((item) => item.id).sort();

		expect(await ids("today")).toStrictEqual(["s-hour"]);
		expect(await ids("week")).toStrictEqual(["s-3d", "s-hour"]);
		expect(await ids("month")).toStrictEqual(["s-20d", "s-3d", "s-hour"]);
	});

	it("limits results to 25 by default and honours an explicit limit", async () => {
		for (let index = 0; index < 30; index += 1) {
			seedSession(`s-${index}`, {title: `login ${index}`});
		}

		expect(await search({query: "login"})).toHaveLength(25);
		expect(await search({query: "login", limit: "5"})).toHaveLength(5);
	});

	it.each([{type: "bogus"}, {date: "year"}, {limit: "0"}, {limit: "abc"}])(
		"rejects invalid parameters %o",
		async (parameters) => {
			const response = request({query: "login", ...parameters});
			expect(response.status).toBe(400);
		},
	);
});
