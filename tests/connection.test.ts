import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import Database from "better-sqlite3";
import {eq, sql} from "drizzle-orm";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {INDEX_SCHEMA_FINGERPRINT, openAppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";

describe("openAppDb", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, {recursive: true, force: true});
		}
	});

	it("throws under vitest when called without an explicit cacheDir", () => {
		expect(() => openAppDb()).toThrow(/must pass an explicit cacheDir/);
	});

	it("opens the databases when given an explicit cacheDir", () => {
		const cacheDir = mkdtempSync(join(tmpdir(), "open-app-db-test-"));
		tempDirs.push(cacheDir);
		const db = openAppDb({cacheDir});
		db.close();
	});

	it("has a single squashed schema version", () => {
		expect(schema.SCHEMA_VERSION).toBe("1");
	});

	it("has no durable-table migration chain", () => {
		const source = readFileSync(fileURLToPath(new URL("../src/lib/db/connection.ts", import.meta.url)), "utf8");
		expect({
			durableMigrations: source.includes("DURABLE_MIGRATIONS"),
			migrateDurableTables: source.includes("migrateDurableTables"),
		}).toStrictEqual({durableMigrations: false, migrateDurableTables: false});
	});

	it("keeps every table, durable user state included, across a reopen at the same version", () => {
		const cacheDir = mkdtempSync(join(tmpdir(), "open-app-db-test-"));
		tempDirs.push(cacheDir);
		const original = openAppDb({cacheDir});
		original.index
			.insert(schema.projects)
			.values({id: "project-test-100", name: "Alice fixture project", updatedAt: 1_000})
			.run();
		original.index
			.insert(schema.sessionViewStates)
			.values({
				sessionId: "session-test-100",
				lastViewedMessageIndex: 10,
				reviewTargetMessageIndex: 20,
				updatedAt: 2_000,
			})
			.run();
		original.close();

		const reopened = openAppDb({cacheDir});
		const state = {
			projects: reopened.index.select().from(schema.projects).all(),
			sessionViewStates: reopened.index.select().from(schema.sessionViewStates).all(),
		};
		reopened.close();

		expect(state).toStrictEqual({
			projects: [
				{
					id: "project-test-100",
					name: "Alice fixture project",
					projectPath: null,
					updatedAt: 1_000,
				},
			],
			sessionViewStates: [
				{
					sessionId: "session-test-100",
					lastViewedMessageIndex: 10,
					reviewTargetMessageIndex: 20,
					updatedAt: 2_000,
				},
			],
		});
	});

	it.each(["38", "37", "2", "0"])(
		"wipes a database at schema version %s, durable tables included, and recreates it at version 1",
		(staleVersion) => {
			const cacheDir = mkdtempSync(join(tmpdir(), "open-app-db-test-"));
			tempDirs.push(cacheDir);
			const original = openAppDb({cacheDir});
			original.index
				.insert(schema.projects)
				.values({id: "project-test-100", name: "Alice fixture project", updatedAt: 1_000})
				.run();
			original.index
				.insert(schema.sessionViewStates)
				.values({
					sessionId: "session-test-100",
					lastViewedMessageIndex: 10,
					reviewTargetMessageIndex: 20,
					updatedAt: 2_000,
				})
				.run();
			original.index
				.insert(schema.archivedSessions)
				.values({sessionId: "session-test-100", archivedAt: 3_000})
				.run();
			original.index
				.insert(schema.homeDismissals)
				.values({sessionId: "session-test-100", dismissedAt: 4_000})
				.run();
			original.close();
			const sqlite = new Database(join(cacheDir, "index.db"));
			sqlite.exec("CREATE TABLE starred_sessions (session_id TEXT PRIMARY KEY, starred_at INTEGER NOT NULL)");
			sqlite.exec("INSERT INTO starred_sessions VALUES ('session-test-100', 1000)");
			sqlite.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'").run(staleVersion);
			sqlite.close();

			const reopened = openAppDb({cacheDir});
			const state = {
				projects: reopened.index.select().from(schema.projects).all(),
				sessionViewStates: reopened.index.select().from(schema.sessionViewStates).all(),
				archivedSessions: reopened.index.select().from(schema.archivedSessions).all(),
				homeDismissals: reopened.index.select().from(schema.homeDismissals).all(),
				starredSessionsTable: reopened.index.all(
					sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'starred_sessions'`,
				),
				version: reopened.index
					.select({value: schema.metadata.value})
					.from(schema.metadata)
					.where(eq(schema.metadata.key, "schema_version"))
					.get(),
			};
			reopened.close();

			expect(state).toStrictEqual({
				projects: [],
				sessionViewStates: [],
				archivedSessions: [],
				homeDismissals: [],
				starredSessionsTable: [],
				version: {value: "1"},
			});
		},
	);

	function oldShapeIndexDb(fingerprint: string | null): string {
		const cacheDir = mkdtempSync(join(tmpdir(), "open-app-db-test-"));
		tempDirs.push(cacheDir);
		const sqlite = new Database(join(cacheDir, "index.db"));
		sqlite.exec(`CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			CREATE TABLE message_content (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL);
			CREATE INDEX message_content_session_idx ON message_content(session_id);
			INSERT INTO message_content(session_id, content) VALUES ('session-test-100', 'Alice old blob');`);
		sqlite.prepare("INSERT INTO metadata (key, value) VALUES ('schema_version', ?)").run(schema.SCHEMA_VERSION);
		if (fingerprint !== null) {
			sqlite.prepare("INSERT INTO metadata (key, value) VALUES ('schema_fingerprint', ?)").run(fingerprint);
		}
		sqlite.close();
		return cacheDir;
	}

	it.each([null, "stale-fingerprint"])(
		"rebuilds a database at the current version whose schema fingerprint is %s",
		(fingerprint) => {
			const cacheDir = oldShapeIndexDb(fingerprint);

			const reopened = openAppDb({cacheDir});
			const state = {
				uniqueIndex: reopened.index.all(
					sql`SELECT name FROM pragma_index_list('message_content') WHERE "unique" = 1 AND name = 'message_content_session_idx'`,
				),
				columns: reopened.index.all(sql`SELECT name FROM pragma_table_info('message_content') ORDER BY cid`),
				rows: reopened.index.all(sql`SELECT * FROM message_content`),
				fingerprint: reopened.index
					.select({value: schema.metadata.value})
					.from(schema.metadata)
					.where(eq(schema.metadata.key, "schema_fingerprint"))
					.get(),
			};
			reopened.close();

			expect(state).toStrictEqual({
				uniqueIndex: [{name: "message_content_session_idx"}],
				columns: [{name: "id"}, {name: "session_id"}, {name: "message_index"}, {name: "content"}],
				rows: [],
				fingerprint: {value: INDEX_SCHEMA_FINGERPRINT},
			});
		},
	);

	it("does not rebuild a database whose schema fingerprint matches", () => {
		const cacheDir = mkdtempSync(join(tmpdir(), "open-app-db-test-"));
		tempDirs.push(cacheDir);
		const original = openAppDb({cacheDir});
		original.index
			.insert(schema.projects)
			.values({id: "project-test-100", name: "Alice fixture project", updatedAt: 1_000})
			.run();
		original.close();

		const reopened = openAppDb({cacheDir});
		const state = {
			projects: reopened.index.select({id: schema.projects.id}).from(schema.projects).all(),
			fingerprint: reopened.index
				.select({value: schema.metadata.value})
				.from(schema.metadata)
				.where(eq(schema.metadata.key, "schema_fingerprint"))
				.get(),
		};
		reopened.close();

		expect(state).toStrictEqual({
			projects: [{id: "project-test-100"}],
			fingerprint: {value: INDEX_SCHEMA_FINGERPRINT},
		});
	});

	it("never creates starred_sessions in a fresh database", () => {
		const cacheDir = mkdtempSync(join(tmpdir(), "open-app-db-test-"));
		tempDirs.push(cacheDir);
		openAppDb({cacheDir}).close();
		const sqlite = new Database(join(cacheDir, "index.db"));
		const tables = sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'starred_sessions'")
			.all();
		sqlite.close();

		expect(tables).toStrictEqual([]);
	});
});
