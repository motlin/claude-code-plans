import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as schema from "./schema";

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
  cwd TEXT,
  is_sidechain INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  file_path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_project_id_idx ON sessions(project_id);
CREATE INDEX IF NOT EXISTS sessions_mtime_desc_idx ON sessions(mtime_ms);
CREATE INDEX IF NOT EXISTS sessions_git_branch_idx ON sessions(git_branch);

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
  slug TEXT,
  description TEXT,
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

CREATE TABLE IF NOT EXISTS starred_sessions (
  session_id TEXT PRIMARY KEY,
  starred_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  filename TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plans_mtime_desc_idx ON plans(mtime_ms);

CREATE TABLE IF NOT EXISTS reviews (
  review_id TEXT PRIMARY KEY,
  bundle TEXT NOT NULL
);

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

CREATE VIRTUAL TABLE IF NOT EXISTS file_content_fts USING fts5(
  path UNINDEXED,
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

function dropAllTables(sqlite: Database.Database): void {
  sqlite.exec("DROP TABLE IF EXISTS sessions_fts");
  sqlite.exec("DROP TABLE IF EXISTS message_content_fts");
  sqlite.exec("DROP TABLE IF EXISTS file_content_fts");
  sqlite.exec("DROP TABLE IF EXISTS tasks");
  sqlite.exec("DROP TABLE IF EXISTS todo_tasks");
  sqlite.exec("DROP TABLE IF EXISTS todo_files");
  sqlite.exec("DROP TABLE IF EXISTS memories");
  sqlite.exec("DROP TABLE IF EXISTS starred_sessions");
  sqlite.exec("DROP TABLE IF EXISTS plans");
  sqlite.exec("DROP TABLE IF EXISTS reviews");
  sqlite.exec("DROP TABLE IF EXISTS hook_schema_drift");
  sqlite.exec("DROP TABLE IF EXISTS herdr_terminal_view_states");
  sqlite.exec("DROP TABLE IF EXISTS session_view_states");
  sqlite.exec("DROP TABLE IF EXISTS subagents");
  sqlite.exec("DROP TABLE IF EXISTS plan_sessions");
  sqlite.exec("DROP TABLE IF EXISTS sessions");
  sqlite.exec("DROP TABLE IF EXISTS projects");
  sqlite.exec("DROP TABLE IF EXISTS indexed_files");
  sqlite.exec("DROP TABLE IF EXISTS metadata");
}

function initIndexDb(sqlite: Database.Database): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const metadataExists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'")
    .get() as { name: string } | undefined;
  if (metadataExists) {
    const row = sqlite.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    if (!row || row.value !== schema.SCHEMA_VERSION) {
      dropAllTables(sqlite);
    }
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

export function getCacheDir(): string {
  const xdg = process.env["XDG_CACHE_HOME"];
  const base = xdg || join(homedir(), ".cache");
  return join(base, "claude-code-plans");
}

export function openAppDb(opts?: { cacheDir?: string | undefined }): AppDb {
  // Under vitest, refuse to fall back to the production cache dir. Doing so
  // opens the real index.db and contends for its write lock with a running
  // dev/prod server — a failure that only surfaces when the app happens to
  // be running. Force tests to be explicit (openTestDb or a temp dir).
  if (process.env["VITEST"] && !opts?.cacheDir) {
    throw new Error(
      "openAppDb: tests must pass an explicit cacheDir (use openTestDb or a temp dir)",
    );
  }
  const cacheDir = opts?.cacheDir ?? getCacheDir();
  mkdirSync(cacheDir, { recursive: true });

  const indexSqlite = new Database(join(cacheDir, "index.db"));
  initIndexDb(indexSqlite);
  const indexDb = drizzle(indexSqlite, { schema });

  const summariesSqlite = new Database(join(cacheDir, "summaries.db"));
  initSummariesDb(summariesSqlite);
  const summariesDb = drizzle(summariesSqlite, { schema });

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
  const indexSqlite = new Database(":memory:");
  initIndexDb(indexSqlite);
  const indexDb = drizzle(indexSqlite, { schema });

  const summariesSqlite = new Database(":memory:");
  initSummariesDb(summariesSqlite);
  const summariesDb = drizzle(summariesSqlite, { schema });

  return {
    index: indexDb,
    summaries: summariesDb,
    close() {
      indexSqlite.close();
      summariesSqlite.close();
    },
  };
}
