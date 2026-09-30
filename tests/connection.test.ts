import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import Database from "better-sqlite3";
import {eq, sql} from "drizzle-orm";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {openAppDb} from "../src/lib/db/connection";
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
