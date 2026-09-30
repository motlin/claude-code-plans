import {drizzle, type BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {homedir} from "node:os";
import * as schema from "./schema";
import {instrumentDatabase} from "../perf/server-scope";

export interface AppDb {
	index: BetterSQLite3Database<typeof schema>;
	summaries: BetterSQLite3Database<typeof schema>;
	close(): void;
}

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS indexed_files (
  path TEXT PRIMARY KEY,
  mtime_ms INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_path TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  first_prompt TEXT,
  summary TEXT,
  custom_title TEXT,
  ai_title TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  pr_repository TEXT,
  forked_from_session_id TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  git_branch TEXT,
  cwd TEXT,
  is_sidechain INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  file_path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_project_id_idx ON sessions(project_id);
CREATE INDEX IF NOT EXISTS sessions_mtime_desc_idx ON sessions(mtime_ms);
CREATE INDEX IF NOT EXISTS sessions_git_branch_idx ON sessions(git_branch);

CREATE TABLE IF NOT EXISTS session_messages (
  session_id TEXT NOT NULL,
  message_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT,
  PRIMARY KEY (session_id, message_index)
);
CREATE INDEX IF NOT EXISTS session_messages_latest_idx
  ON session_messages(session_id, role, message_index);

CREATE TABLE IF NOT EXISTS session_mcp_tools (
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  PRIMARY KEY (session_id, tool_name)
);
CREATE INDEX IF NOT EXISTS session_mcp_tools_tool_name_idx ON session_mcp_tools(tool_name);

CREATE TABLE IF NOT EXISTS artifact_events (
  tool_use_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  ts INTEGER NOT NULL,
  action TEXT NOT NULL,
  url TEXT NOT NULL,
  is_subagent INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  favicon TEXT,
  description TEXT,
  source_path TEXT,
  version TEXT,
  audience TEXT
);
CREATE INDEX IF NOT EXISTS artifact_events_session_idx ON artifact_events(session_id);
CREATE INDEX IF NOT EXISTS artifact_events_file_path_idx ON artifact_events(file_path);
CREATE INDEX IF NOT EXISTS artifact_events_url_idx ON artifact_events(url);

CREATE TABLE IF NOT EXISTS artifacts (
  url TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  url_kind TEXT NOT NULL,
  title TEXT,
  favicon TEXT,
  description TEXT,
  source_path TEXT,
  version TEXT,
  audience TEXT,
  first_seen_at INTEGER NOT NULL,
  last_published_at INTEGER,
  publish_count INTEGER NOT NULL DEFAULT 0,
  last_session_id TEXT NOT NULL,
  project_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_last_published_idx ON artifacts(last_published_at);

CREATE TABLE IF NOT EXISTS routines (
  tool_use_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  record_uuid TEXT,
  kind TEXT NOT NULL,
  routine_id TEXT,
  name TEXT,
  schedule TEXT,
  human_schedule TEXT,
  delay_seconds INTEGER,
  run_once_at INTEGER,
  recurring INTEGER NOT NULL,
  durable INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS routines_session_idx ON routines(session_id);
CREATE INDEX IF NOT EXISTS routines_file_path_idx ON routines(file_path);

CREATE TABLE IF NOT EXISTS usage_daily (
  file_path TEXT NOT NULL,
  session_id TEXT NOT NULL,
  day TEXT NOT NULL,
  model TEXT,
  messages INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_daily_file_path_idx ON usage_daily(file_path);
CREATE INDEX IF NOT EXISTS usage_daily_session_idx ON usage_daily(session_id);

CREATE TABLE IF NOT EXISTS plan_sessions (
  plan_filename TEXT NOT NULL,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY(plan_filename, session_id)
);
CREATE INDEX IF NOT EXISTS plan_sessions_plan_idx ON plan_sessions(plan_filename);
CREATE INDEX IF NOT EXISTS plan_sessions_session_idx ON plan_sessions(session_id);

CREATE TABLE IF NOT EXISTS subagents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  parent_agent_id TEXT,
  agent_type TEXT,
  attribution_agent TEXT,
  slug TEXT,
  description TEXT,
  model TEXT,
  started_at TEXT,
  finished_at TEXT,
  file_path TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subagents_session_idx ON subagents(session_id);

CREATE TABLE IF NOT EXISTS tasks (
  file_path TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  project_dir TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  active_form TEXT,
  owner TEXT,
  blocks_json TEXT NOT NULL DEFAULT '[]',
  blocked_by_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  mtime_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_project_dir_idx ON tasks(project_dir);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_owner_idx ON tasks(owner);

CREATE TABLE IF NOT EXISTS memories (
  file_path TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  title TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memories_project_id_idx ON memories(project_id);

CREATE TABLE IF NOT EXISTS plans (
  filename TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plans_mtime_desc_idx ON plans(mtime_ms);

CREATE TABLE IF NOT EXISTS hook_schema_drift (
  hook_event_name TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  raw_body TEXT NOT NULL,
  issues_json TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (hook_event_name, body_sha256)
);
CREATE INDEX IF NOT EXISTS hook_schema_drift_last_seen_idx ON hook_schema_drift(last_seen_at);

CREATE TABLE IF NOT EXISTS session_view_states (
  session_id TEXT PRIMARY KEY,
  last_viewed_message_index INTEGER NOT NULL DEFAULT -1,
  review_target_message_index INTEGER NOT NULL DEFAULT -1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS herdr_terminal_view_states (
  terminal_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  viewed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS herdr_terminal_view_states_session_idx
  ON herdr_terminal_view_states(session_id);

CREATE TABLE IF NOT EXISTS reviews (
  review_id TEXT PRIMARY KEY,
  bundle TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS archived_sessions (
  session_id TEXT PRIMARY KEY,
  archived_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS home_dismissals (
  session_id TEXT PRIMARY KEY,
  dismissed_at INTEGER NOT NULL
);
`;

// FTS5 tables can only seek by rowid or MATCH, so a `DELETE ... WHERE path = ?`
// on an FTS table scans every row of the (multi-GB) index. Each FTS table is
// therefore external-content over a regular table with an indexed key column;
// deletes go through the content table and its triggers remove FTS rows by rowid.
const CREATE_FTS_SQL = `
CREATE TABLE IF NOT EXISTS sessions_search (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  first_prompt TEXT NOT NULL,
  summary TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
  session_id UNINDEXED,
  title,
  first_prompt,
  summary,
  content='sessions_search',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS sessions_search_fts_insert AFTER INSERT ON sessions_search BEGIN
  INSERT INTO sessions_fts(rowid, session_id, title, first_prompt, summary)
  VALUES (NEW.id, NEW.session_id, NEW.title, NEW.first_prompt, NEW.summary);
END;

CREATE TRIGGER IF NOT EXISTS sessions_search_fts_delete AFTER DELETE ON sessions_search BEGIN
  INSERT INTO sessions_fts(sessions_fts, rowid, session_id, title, first_prompt, summary)
  VALUES ('delete', OLD.id, OLD.session_id, OLD.title, OLD.first_prompt, OLD.summary);
END;

CREATE TRIGGER IF NOT EXISTS sessions_fts_insert AFTER INSERT ON sessions BEGIN
  DELETE FROM sessions_search WHERE session_id = NEW.id;
  INSERT INTO sessions_search(session_id, title, first_prompt, summary)
  VALUES (NEW.id, NEW.title, COALESCE(NEW.first_prompt, ''), COALESCE(NEW.summary, ''));
END;

CREATE TRIGGER IF NOT EXISTS sessions_fts_update AFTER UPDATE ON sessions BEGIN
  DELETE FROM sessions_search WHERE session_id = OLD.id;
  DELETE FROM sessions_search WHERE session_id = NEW.id;
  INSERT INTO sessions_search(session_id, title, first_prompt, summary)
  VALUES (NEW.id, NEW.title, COALESCE(NEW.first_prompt, ''), COALESCE(NEW.summary, ''));
END;

CREATE TRIGGER IF NOT EXISTS sessions_fts_delete AFTER DELETE ON sessions BEGIN
  DELETE FROM sessions_search WHERE session_id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS message_content (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_content_session_idx ON message_content(session_id);

CREATE VIRTUAL TABLE IF NOT EXISTS message_content_fts USING fts5(
  session_id UNINDEXED,
  content,
  content='message_content',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS message_content_fts_insert AFTER INSERT ON message_content BEGIN
  INSERT INTO message_content_fts(rowid, session_id, content)
  VALUES (NEW.id, NEW.session_id, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS message_content_fts_delete AFTER DELETE ON message_content BEGIN
  INSERT INTO message_content_fts(message_content_fts, rowid, session_id, content)
  VALUES ('delete', OLD.id, OLD.session_id, OLD.content);
END;

CREATE TABLE IF NOT EXISTS file_content (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS file_content_fts USING fts5(
  path UNINDEXED,
  content,
  content='file_content',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS file_content_fts_insert AFTER INSERT ON file_content BEGIN
  INSERT INTO file_content_fts(rowid, path, content) VALUES (NEW.id, NEW.path, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS file_content_fts_delete AFTER DELETE ON file_content BEGIN
  INSERT INTO file_content_fts(file_content_fts, rowid, path, content)
  VALUES ('delete', OLD.id, OLD.path, OLD.content);
END;

CREATE TABLE IF NOT EXISTS docs_content (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('plan', 'memory')),
  project_id TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS docs_content_project_idx ON docs_content(project_id);

CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  path UNINDEXED,
  kind UNINDEXED,
  title,
  content,
  content='docs_content',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS docs_fts_insert AFTER INSERT ON docs_content BEGIN
  INSERT INTO docs_fts(rowid, path, kind, title, content)
  VALUES (NEW.id, NEW.path, NEW.kind, NEW.title, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS docs_fts_delete AFTER DELETE ON docs_content BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, path, kind, title, content)
  VALUES ('delete', OLD.id, OLD.path, OLD.kind, OLD.title, OLD.content);
END;
`;

const CREATE_SUMMARIES_SQL = `
CREATE TABLE IF NOT EXISTS summaries (
  session_id TEXT PRIMARY KEY,
  last_message_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);
`;

// A schema version mismatch wipes the whole index database, user-state tables
// included, and recreates it from CREATE_TABLES_SQL + CREATE_FTS_SQL. There is
// no migration chain: bump SCHEMA_VERSION for any DDL or indexed-data change.
function dropAllObjects(sqlite: Database.Database): void {
	const objects = sqlite
		.prepare(
			`SELECT type, name, sql FROM sqlite_master
       WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%'`,
		)
		.all() as {type: "table" | "view" | "trigger"; name: string; sql: string | null}[];
	const isVirtual = (object: {sql: string | null}) => /^CREATE VIRTUAL TABLE/i.test(object.sql ?? "");
	// Virtual tables first: dropping one also drops its FTS5 shadow tables.
	const ordered = [
		...objects.filter((object) => object.type === "trigger"),
		...objects.filter((object) => object.type === "view"),
		...objects.filter((object) => object.type === "table" && isVirtual(object)),
		...objects.filter((object) => object.type === "table" && !isVirtual(object)),
	];
	for (const {type, name} of ordered) {
		sqlite.exec(`DROP ${type.toUpperCase()} IF EXISTS "${name.replaceAll('"', '""')}"`);
	}
}

function readSchemaVersion(sqlite: Database.Database): string | null {
	const metadataExists = sqlite
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'")
		.get() as {name: string} | undefined;
	if (!metadataExists) return null;

	const row = sqlite.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as
		| {value: string}
		| undefined;
	return row?.value ?? null;
}

function initIndexDb(sqlite: Database.Database): void {
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");

	if (readSchemaVersion(sqlite) !== schema.SCHEMA_VERSION) {
		sqlite.transaction(() => dropAllObjects(sqlite))();
	}

	sqlite.exec(CREATE_TABLES_SQL);
	sqlite.exec(CREATE_FTS_SQL);
	sqlite
		.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', ?)")
		.run(schema.SCHEMA_VERSION);
}
function initSummariesDb(sqlite: Database.Database): void {
	sqlite.pragma("journal_mode = WAL");
	sqlite.exec(CREATE_SUMMARIES_SQL);
}

/**
 * How long a connection blocks waiting for another connection's write lock
 * before failing with SQLITE_BUSY. A restarted dev server can briefly overlap
 * the previous instance, whose scan still holds the lock.
 */
const BUSY_TIMEOUT_MS = 10_000;

type SchemaDb = BetterSQLite3Database<typeof schema>;

/**
 * Wraps drizzle so every top-level transaction begins IMMEDIATE. A deferred
 * transaction that reads before it writes must upgrade its read lock, and in
 * WAL mode that upgrade fails with SQLITE_BUSY at once, skipping the busy
 * timeout, whenever another connection holds the write lock. BEGIN IMMEDIATE
 * takes the write lock up front, where the busy timeout applies.
 */
function openDrizzle(sqlite: Database.Database): SchemaDb {
	const db = drizzle(sqlite, {schema});
	const beginTransaction = db.transaction.bind(db);
	db.transaction = (transaction, config) => beginTransaction(transaction, {behavior: "immediate", ...config});
	return db;
}

function openSqlite(filename: string): Database.Database {
	return new Database(filename, {timeout: BUSY_TIMEOUT_MS});
}

export function getCacheDir(): string {
	const xdg = process.env["XDG_CACHE_HOME"];
	const base = xdg || join(homedir(), ".cache");
	return join(base, "claude-code-plans");
}

export function openAppDb(opts?: {cacheDir?: string | undefined}): AppDb {
	// Under vitest, refuse to fall back to the production cache dir. Doing so
	// opens the real index.db and contends for its write lock with a running
	// dev/prod server — a failure that only surfaces when the app happens to
	// be running. Force tests to be explicit (openTestDb or a temp dir).
	if (process.env["VITEST"] && !opts?.cacheDir) {
		throw new Error("openAppDb: tests must pass an explicit cacheDir (use openTestDb or a temp dir)");
	}
	const cacheDir = opts?.cacheDir ?? getCacheDir();
	mkdirSync(cacheDir, {recursive: true});

	const indexSqlite = openSqlite(join(cacheDir, "index.db"));
	initIndexDb(indexSqlite);
	instrumentDatabase(indexSqlite);
	const indexDb = openDrizzle(indexSqlite);

	const summariesSqlite = openSqlite(join(cacheDir, "summaries.db"));
	initSummariesDb(summariesSqlite);
	instrumentDatabase(summariesSqlite);
	const summariesDb = openDrizzle(summariesSqlite);

	return {
		index: indexDb,
		summaries: summariesDb,
		close() {
			indexSqlite.close();
			summariesSqlite.close();
		},
	};
}

export function openTestDb(): AppDb {
	const indexSqlite = openSqlite(":memory:");
	initIndexDb(indexSqlite);
	instrumentDatabase(indexSqlite);
	const indexDb = openDrizzle(indexSqlite);

	const summariesSqlite = openSqlite(":memory:");
	initSummariesDb(summariesSqlite);
	instrumentDatabase(summariesSqlite);
	const summariesDb = openDrizzle(summariesSqlite);

	return {
		index: indexDb,
		summaries: summariesDb,
		close() {
			indexSqlite.close();
			summariesSqlite.close();
		},
	};
}
