import {mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {sql} from "drizzle-orm";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {deleteFileContent, deleteMemoryFile, fullScan, indexFile, indexFileContent} from "../src/lib/db/indexer";
import {searchFileContentDb, searchMessageContentDb, searchSessionsFromDb} from "../src/lib/db/queries";

const FTS_TABLES = ["sessions_fts", "message_content_fts", "file_content_fts", "docs_fts"] as const;

function jsonl(...lines: Record<string, unknown>[]): string {
	return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

function rawClient(db: AppDb): Database.Database {
	const client: unknown = Reflect.get(db.index, "$client");
	if (!(client instanceof Database)) throw new Error("index db has no better-sqlite3 client");
	return client;
}

/** Plan steps that scan an FTS5 table without a rowid or MATCH constraint. */
function fullFtsScans(client: Database.Database, statement: string): string[] {
	const placeholderCount = statement.match(/\?/g)?.length ?? 0;
	const plan = client
		.prepare(`EXPLAIN QUERY PLAN ${statement}`)
		.all(...Array.from({length: placeholderCount}, () => null)) as Array<{detail: string}>;
	return plan
		.map((step) => step.detail)
		.filter((detail) => {
			const match = /^SCAN (\w+) VIRTUAL TABLE INDEX \d+:(.*)$/.exec(detail);
			return match !== null && (FTS_TABLES as readonly string[]).includes(match[1] ?? "") && match[2] === "";
		});
}

/** Record every SQL statement prepared on the index connection while `action` runs. */
async function recordStatements(db: AppDb, action: () => Promise<void>): Promise<string[]> {
	const client = rawClient(db);
	const originalPrepare = client.prepare.bind(client);
	const statements: string[] = [];
	client.prepare = ((source: string) => {
		statements.push(source);
		return originalPrepare(source);
	}) as typeof client.prepare;
	try {
		await action();
	} finally {
		client.prepare = originalPrepare;
	}
	return statements;
}

function triggerBodyStatements(client: Database.Database): Array<{name: string; sql: string}> {
	const triggers = client
		.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
		.all() as Array<{name: string; sql: string}>;
	return triggers.flatMap((trigger) => {
		const body = /\bBEGIN\b([\s\S]*)\bEND\s*$/i.exec(trigger.sql)?.[1] ?? "";
		return body
			.split(";")
			.map((statement) => statement.trim())
			.filter((statement) => statement.length > 0)
			.map((statement) => ({
				name: trigger.name,
				sql: statement.replace(/\b(?:NEW|OLD)\.\w+/gi, "'fixture'"),
			}));
	});
}

describe("FTS delete query plans", () => {
	let fixtureDirectory: string;
	let projectsDir: string;
	let fileRoot: string;
	let db: AppDb;

	beforeEach(() => {
		fixtureDirectory = join(realpathSync(tmpdir()), `claude-fts-delete-plan-${process.pid}-${Date.now()}`);
		projectsDir = join(fixtureDirectory, "projects");
		fileRoot = join(fixtureDirectory, "files");
		mkdirSync(projectsDir, {recursive: true});
		mkdirSync(fileRoot, {recursive: true});
		db = openTestDb();
	});

	afterEach(() => {
		db.close();
		rmSync(fixtureDirectory, {recursive: true, force: true});
	});

	function writeSession(sessionId: string, text: string, mtimeSeconds: number): string {
		const projectDir = join(projectsDir, "-tmp-alice-project");
		mkdirSync(projectDir, {recursive: true});
		const sessionPath = join(projectDir, `${sessionId}.jsonl`);
		writeFileSync(
			sessionPath,
			jsonl(
				{type: "user", message: {content: `Ask Alice about ${text}`}},
				{type: "assistant", message: {content: `Alice answers ${text}`}},
			),
		);
		utimesSync(sessionPath, mtimeSeconds, mtimeSeconds);
		return sessionPath;
	}

	it("no trigger body full-scans an FTS table", () => {
		const client = rawClient(db);
		const statements = triggerBodyStatements(client);
		const scans = statements
			.map((statement) => ({name: statement.name, scans: fullFtsScans(client, statement.sql)}))
			.filter((entry) => entry.scans.length > 0);

		expect({hasTriggers: statements.length > 0, scans}).toStrictEqual({
			hasTriggers: true,
			scans: [],
		});
	});

	it("indexing, reindexing and deleting never full-scan an FTS table", async () => {
		const sessionPath = writeSession("session-alice", "platypus", 946_684_800);
		const filePath = join(fileRoot, "alice.txt");

		const statements = await recordStatements(db, async () => {
			await fullScan(db.index, db.summaries, projectsDir);
			writeSession("session-alice", "wombat", 946_684_900);
			await fullScan(db.index, db.summaries, projectsDir);
			rmSync(sessionPath);
			await fullScan(db.index, db.summaries, projectsDir);

			writeFileSync(filePath, "Alice keeps a platypus.\n");
			await indexFileContent(db.index, filePath, [fileRoot]);
			writeFileSync(filePath, "Alice keeps a wombat now.\n");
			utimesSync(filePath, 946_684_900, 946_684_900);
			await indexFileContent(db.index, filePath, [fileRoot]);
			deleteFileContent(db.index, filePath);

			const plansDir = join(fixtureDirectory, "plans");
			mkdirSync(plansDir, {recursive: true});
			const planPath = join(plansDir, "alice.md");
			writeFileSync(planPath, "# Alice plan\n\nFeed the platypus.\n");
			await indexFile(db.index, planPath, projectsDir, plansDir);
			writeFileSync(planPath, "# Alice plan\n\nFeed the wombat.\n");
			utimesSync(planPath, 946_684_900, 946_684_900);
			await indexFile(db.index, planPath, projectsDir, plansDir);
			rmSync(planPath);
			await indexFile(db.index, planPath, projectsDir, plansDir);

			const memoryDir = join(projectsDir, "-tmp-alice-project", "memory");
			mkdirSync(memoryDir, {recursive: true});
			const memoryPath = join(memoryDir, "alice.md");
			writeFileSync(memoryPath, "# Alice memory\n\nFeed the platypus.\n");
			await indexFile(db.index, memoryPath, projectsDir, plansDir);
			writeFileSync(memoryPath, "# Alice memory\n\nFeed the wombat.\n");
			utimesSync(memoryPath, 946_684_900, 946_684_900);
			await indexFile(db.index, memoryPath, projectsDir, plansDir);
			rmSync(memoryPath);
			deleteMemoryFile(db.index, memoryPath);
		});

		const client = rawClient(db);
		const scans = [...new Set(statements)]
			.map((statement) => ({statement, scans: fullFtsScans(client, statement)}))
			.filter((entry) => entry.scans.length > 0);

		expect(scans).toStrictEqual([]);
	});

	it("removes every FTS row for a session indexed twice and then deleted", async () => {
		const sessionId = "session-alice";
		const sessionPath = writeSession(sessionId, "platypus", 946_684_800);
		await fullScan(db.index, db.summaries, projectsDir);
		writeSession(sessionId, "platypus again", 946_684_900);
		await fullScan(db.index, db.summaries, projectsDir);

		const beforeDelete = {
			messageRows: db.index.all(sql`SELECT session_id FROM message_content_fts WHERE session_id = ${sessionId}`),
			sessionRows: db.index.all(sql`SELECT session_id FROM sessions_fts WHERE session_id = ${sessionId}`),
			messageHits: searchMessageContentDb(db.index, "platypus").map((hit) => hit.sessionId),
		};

		rmSync(sessionPath);
		await fullScan(db.index, db.summaries, projectsDir);

		const afterDelete = {
			messageRows: db.index.all(sql`SELECT session_id FROM message_content_fts WHERE session_id = ${sessionId}`),
			sessionRows: db.index.all(sql`SELECT session_id FROM sessions_fts WHERE session_id = ${sessionId}`),
			messageHits: searchMessageContentDb(db.index, "platypus").map((hit) => hit.sessionId),
			sessionHits: searchSessionsFromDb(db.index, "Alice").map((hit) => hit.sessionId),
		};

		expect({beforeDelete, afterDelete}).toStrictEqual({
			beforeDelete: {
				messageRows: [{session_id: sessionId}],
				sessionRows: [{session_id: sessionId}],
				messageHits: [sessionId],
			},
			afterDelete: {
				messageRows: [],
				sessionRows: [],
				messageHits: [],
				sessionHits: [],
			},
		});
	});

	it("removes every FTS row for a file indexed twice and then deleted", async () => {
		const filePath = join(fileRoot, "alice.txt");
		writeFileSync(filePath, "Alice keeps a platypus.\n");
		await indexFileContent(db.index, filePath, [fileRoot]);
		writeFileSync(filePath, "Alice keeps a platypus and a wombat.\n");
		utimesSync(filePath, 946_684_900, 946_684_900);
		await indexFileContent(db.index, filePath, [fileRoot]);

		const beforeDelete = db.index.all(sql`SELECT path FROM file_content_fts`);
		deleteFileContent(db.index, filePath);
		const afterDelete = {
			rows: db.index.all(sql`SELECT path FROM file_content_fts`),
			hits: searchFileContentDb(db.index, "platypus", fileRoot).totalFiles,
		};

		expect({beforeDelete, afterDelete}).toStrictEqual({
			beforeDelete: [{path: filePath}],
			afterDelete: {rows: [], hits: 0},
		});
	});
});
