import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";
import type { ReviewBundle } from "../api/reviews";

export const SCHEMA_VERSION = "18";

export const metadata = sqliteTable("metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const indexedFiles = sqliteTable("indexed_files", {
  path: text("path").primaryKey(),
  mtimeMs: integer("mtime_ms").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  indexedAt: integer("indexed_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  projectPath: text("project_path"),
  updatedAt: integer("updated_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    title: text("title").notNull(),
    firstPrompt: text("first_prompt"),
    summary: text("summary"),
    customTitle: text("custom_title"),
    messageCount: integer("message_count").notNull().default(0),
    gitBranch: text("git_branch"),
    cwd: text("cwd"),
    isSidechain: integer("is_sidechain").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    mtimeMs: integer("mtime_ms").notNull(),
    filePath: text("file_path").notNull(),
  },
  (table) => [
    index("sessions_project_id_idx").on(table.projectId),
    index("sessions_mtime_desc_idx").on(table.mtimeMs),
    index("sessions_git_branch_idx").on(table.gitBranch),
  ],
);

export const sessionViewStates = sqliteTable("session_view_states", {
  sessionId: text("session_id").primaryKey(),
  lastViewedMessageIndex: integer("last_viewed_message_index").notNull().default(-1),
  reviewTargetMessageIndex: integer("review_target_message_index").notNull().default(-1),
  updatedAt: integer("updated_at").notNull(),
});

export const herdrTerminalViewStates = sqliteTable(
  "herdr_terminal_view_states",
  {
    terminalId: text("terminal_id").primaryKey(),
    sessionId: text("session_id").notNull(),
    viewed: integer("viewed").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("herdr_terminal_view_states_session_idx").on(table.sessionId)],
);

export const planSessions = sqliteTable(
  "plan_sessions",
  {
    planFilename: text("plan_filename").notNull(),
    sessionId: text("session_id").notNull(),
    projectId: text("project_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.planFilename, table.sessionId] }),
    index("plan_sessions_plan_idx").on(table.planFilename),
    index("plan_sessions_session_idx").on(table.sessionId),
  ],
);

export const subagents = sqliteTable(
  "subagents",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    projectId: text("project_id").notNull(),
    parentAgentId: text("parent_agent_id"),
    agentType: text("agent_type"),
    slug: text("slug"),
    description: text("description"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    filePath: text("file_path").notNull(),
    mtimeMs: integer("mtime_ms").notNull(),
  },
  (table) => [index("subagents_session_idx").on(table.sessionId)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    filePath: text("file_path").primaryKey(),
    taskId: text("task_id").notNull(),
    projectDir: text("project_dir").notNull(),
    subject: text("subject").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull(),
    activeForm: text("active_form"),
    owner: text("owner"),
    blocksJson: text("blocks_json").notNull().default("[]"),
    blockedByJson: text("blocked_by_json").notNull().default("[]"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    mtimeMs: integer("mtime_ms").notNull(),
  },
  (table) => [
    index("tasks_project_dir_idx").on(table.projectDir),
    index("tasks_status_idx").on(table.status),
    index("tasks_owner_idx").on(table.owner),
  ],
);

export const memories = sqliteTable(
  "memories",
  {
    filePath: text("file_path").primaryKey(),
    projectId: text("project_id").notNull(),
    filename: text("filename").notNull(),
    title: text("title").notNull(),
    mtimeMs: integer("mtime_ms").notNull(),
  },
  (table) => [index("memories_project_id_idx").on(table.projectId)],
);

export const plans = sqliteTable(
  "plans",
  {
    filename: text("filename").primaryKey(),
    title: text("title").notNull(),
    mtimeMs: integer("mtime_ms").notNull(),
  },
  (table) => [index("plans_mtime_desc_idx").on(table.mtimeMs)],
);

export const starredSessions = sqliteTable("starred_sessions", {
  sessionId: text("session_id").primaryKey(),
  starredAt: integer("starred_at").notNull(),
});

export const summaries = sqliteTable("summaries", {
  sessionId: text("session_id").primaryKey(),
  lastMessageId: text("last_message_id").notNull(),
  summary: text("summary").notNull(),
  generatedAt: integer("generated_at").notNull(),
});

export const reviews = sqliteTable("reviews", {
  reviewId: text("review_id").primaryKey(),
  bundle: text("bundle", { mode: "json" }).$type<ReviewBundle>().notNull(),
});

export const hookSchemaDrift = sqliteTable(
  "hook_schema_drift",
  {
    hookEventName: text("hook_event_name").notNull(),
    bodySha256: text("body_sha256").notNull(),
    rawBody: text("raw_body").notNull(),
    issuesJson: text("issues_json").notNull(),
    count: integer("count").notNull().default(1),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.hookEventName, table.bodySha256] }),
    index("hook_schema_drift_last_seen_idx").on(table.lastSeenAt),
  ],
);
