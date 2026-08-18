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

export class DatabaseSchemaTooNewError extends Error {
  constructor(
    public readonly databaseSchemaVersion: number,
    public readonly applicationSchemaVersion: number,
  ) {
    super(
      `Database schema version ${databaseSchemaVersion} is newer than application schema version ${applicationSchemaVersion}`,
    );
    this.name = "DatabaseSchemaTooNewError";
  }
}

const CREATE_DERIVED_TABLES_SQL = `
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

CREATE TABLE IF NOT EXISTS session_messages (
  session_id TEXT NOT NULL,
  message_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT,
  PRIMARY KEY (session_id, message_index)
);
CREATE INDEX IF NOT EXISTS session_messages_latest_idx
  ON session_messages(session_id, role, message_index);

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

`;

interface DurableMigration {
  schemaVersion: number;
  statements: string;
}

const DURABLE_MIGRATIONS: readonly DurableMigration[] = [
  {
    schemaVersion: 2,
    statements: `
CREATE TABLE IF NOT EXISTS starred_sessions (
  session_id TEXT PRIMARY KEY,
  starred_at INTEGER NOT NULL
);`,
  },
  {
    schemaVersion: 12,
    statements: `
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
CREATE INDEX IF NOT EXISTS hook_schema_drift_last_seen_idx ON hook_schema_drift(last_seen_at);`,
  },
  {
    schemaVersion: 16,
    statements: `
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
  ON herdr_terminal_view_states(session_id);`,
  },
  {
    schemaVersion: 18,
    statements: `
CREATE TABLE IF NOT EXISTS reviews (
  review_id TEXT PRIMARY KEY,
  bundle TEXT NOT NULL
);`,
  },
];

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

const DERIVED_TABLE_NAMES = [
  "sessions_fts",
  "message_content_fts",
  "file_content_fts",
  "tasks",
  "todo_tasks",
  "todo_files",
  "memories",
  "plans",
  "session_messages",
  "subagents",
  "plan_sessions",
  "sessions",
  "projects",
  "indexed_files",
  "metadata",
] as const;

function dropDerivedTables(sqlite: Database.Database): void {
  for (const tableName of DERIVED_TABLE_NAMES) {
    sqlite.exec(`DROP TABLE IF EXISTS ${tableName}`);
  }
}

function parseSchemaVersion(value: string, source: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Invalid ${source} schema version: ${value}`);
  }
  const schemaVersion = Number(value);
  if (!Number.isSafeInteger(schemaVersion)) {
    throw new Error(`Invalid ${source} schema version: ${value}`);
  }
  return schemaVersion;
}

function readSchemaVersion(sqlite: Database.Database): number {
  const metadataExists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'")
    .get() as { name: string } | undefined;
  if (!metadataExists) return 0;

  const row = sqlite.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  if (!row) return 0;
  return parseSchemaVersion(row.value, "database");
}

function migrateDurableTables(
  sqlite: Database.Database,
  previousSchemaVersion: number,
  currentSchemaVersion: number,
): void {
  for (const migration of DURABLE_MIGRATIONS) {
    if (
      migration.schemaVersion > previousSchemaVersion &&
      migration.schemaVersion <= currentSchemaVersion
    ) {
      sqlite.exec(migration.statements);
    }
  }
}

function initIndexDb(sqlite: Database.Database): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const previousSchemaVersion = readSchemaVersion(sqlite);
  const currentSchemaVersion = parseSchemaVersion(schema.SCHEMA_VERSION, "application");
  if (currentSchemaVersion < 1) {
    throw new Error(`Invalid application schema version: ${schema.SCHEMA_VERSION}`);
  }
  if (previousSchemaVersion > currentSchemaVersion) {
    throw new DatabaseSchemaTooNewError(previousSchemaVersion, currentSchemaVersion);
  }
  if (previousSchemaVersion !== currentSchemaVersion) {
    sqlite.transaction(() => {
      migrateDurableTables(sqlite, previousSchemaVersion, currentSchemaVersion);
      dropDerivedTables(sqlite);
    })();
  }

  sqlite.exec(CREATE_DERIVED_TABLES_SQL);
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
