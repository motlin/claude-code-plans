import {drizzle, type BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import * as schema from './schema';

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
  message_count INTEGER NOT NULL DEFAULT 0,
  git_branch TEXT,
  is_sidechain INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  file_path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_project_id_idx ON sessions(project_id);
CREATE INDEX IF NOT EXISTS sessions_mtime_desc_idx ON sessions(mtime_ms);

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
  agent_type TEXT,
  slug TEXT,
  file_path TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subagents_session_idx ON subagents(session_id);

CREATE TABLE IF NOT EXISTS starred_sessions (
  session_id TEXT PRIMARY KEY,
  starred_at INTEGER NOT NULL
);
`;

const CREATE_FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
  session_id UNINDEXED,
  title,
  first_prompt,
  summary
);

CREATE TRIGGER IF NOT EXISTS sessions_fts_insert AFTER INSERT ON sessions BEGIN
  INSERT INTO sessions_fts(session_id, title, first_prompt, summary)
  VALUES (NEW.id, NEW.title, COALESCE(NEW.first_prompt, ''), COALESCE(NEW.summary, ''));
END;

CREATE TRIGGER IF NOT EXISTS sessions_fts_update AFTER UPDATE ON sessions BEGIN
  DELETE FROM sessions_fts WHERE session_id = OLD.id;
  INSERT INTO sessions_fts(session_id, title, first_prompt, summary)
  VALUES (NEW.id, NEW.title, COALESCE(NEW.first_prompt, ''), COALESCE(NEW.summary, ''));
END;

CREATE TRIGGER IF NOT EXISTS sessions_fts_delete AFTER DELETE ON sessions BEGIN
  DELETE FROM sessions_fts WHERE session_id = OLD.id;
END;

CREATE VIRTUAL TABLE IF NOT EXISTS message_content_fts USING fts5(
  session_id UNINDEXED,
  content,
  tokenize='porter unicode61'
);
`;

const CREATE_SUMMARIES_SQL = `
CREATE TABLE IF NOT EXISTS summaries (
  session_id TEXT PRIMARY KEY,
  last_message_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);
`;

function initIndexDb(sqlite: Database.Database): void {
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(CREATE_TABLES_SQL);
	sqlite.exec(CREATE_FTS_SQL);

	const row = sqlite.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as
		| {value: string}
		| undefined;
	if (row && row.value !== schema.SCHEMA_VERSION) {
		// Schema version mismatch — drop and rebuild
		sqlite.exec('DROP TABLE IF EXISTS sessions_fts');
		sqlite.exec('DROP TABLE IF EXISTS message_content_fts');
		sqlite.exec('DROP TABLE IF EXISTS starred_sessions');
		sqlite.exec('DROP TABLE IF EXISTS subagents');
		sqlite.exec('DROP TABLE IF EXISTS plan_sessions');
		sqlite.exec('DROP TABLE IF EXISTS sessions');
		sqlite.exec('DROP TABLE IF EXISTS projects');
		sqlite.exec('DROP TABLE IF EXISTS indexed_files');
		sqlite.exec('DROP TABLE IF EXISTS metadata');
		sqlite.exec(CREATE_TABLES_SQL);
		sqlite.exec(CREATE_FTS_SQL);
	}
	sqlite
		.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', ?)")
		.run(schema.SCHEMA_VERSION);
}

function initSummariesDb(sqlite: Database.Database): void {
	sqlite.pragma('journal_mode = WAL');
	sqlite.exec(CREATE_SUMMARIES_SQL);
}

export function getCacheDir(): string {
	const xdg = process.env['XDG_CACHE_HOME'];
	const base = xdg || join(homedir(), '.cache');
	return join(base, 'claude-code-plans');
}

export function openAppDb(opts?: {cacheDir?: string}): AppDb {
	const cacheDir = opts?.cacheDir ?? getCacheDir();
	mkdirSync(cacheDir, {recursive: true});

	const indexSqlite = new Database(join(cacheDir, 'index.db'));
	initIndexDb(indexSqlite);
	const indexDb = drizzle(indexSqlite, {schema});

	const summariesSqlite = new Database(join(cacheDir, 'summaries.db'));
	initSummariesDb(summariesSqlite);
	const summariesDb = drizzle(summariesSqlite, {schema});

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
	const indexSqlite = new Database(':memory:');
	initIndexDb(indexSqlite);
	const indexDb = drizzle(indexSqlite, {schema});

	const summariesSqlite = new Database(':memory:');
	initSummariesDb(summariesSqlite);
	const summariesDb = drizzle(summariesSqlite, {schema});

	return {
		index: indexDb,
		summaries: summariesDb,
		close() {
			indexSqlite.close();
			summariesSqlite.close();
		},
	};
}
