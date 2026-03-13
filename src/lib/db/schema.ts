import {sqliteTable, text, integer, index, primaryKey} from 'drizzle-orm/sqlite-core';

export const SCHEMA_VERSION = '2';

export const metadata = sqliteTable('metadata', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
});

export const indexedFiles = sqliteTable('indexed_files', {
	path: text('path').primaryKey(),
	mtimeMs: integer('mtime_ms').notNull(),
	sizeBytes: integer('size_bytes').notNull(),
	indexedAt: integer('indexed_at').notNull(),
});

export const projects = sqliteTable('projects', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	projectPath: text('project_path'),
	updatedAt: integer('updated_at').notNull(),
});

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		projectId: text('project_id').notNull(),
		title: text('title').notNull(),
		firstPrompt: text('first_prompt'),
		summary: text('summary'),
		customTitle: text('custom_title'),
		messageCount: integer('message_count').notNull().default(0),
		gitBranch: text('git_branch'),
		isSidechain: integer('is_sidechain').notNull().default(0),
		createdAt: integer('created_at').notNull(),
		mtimeMs: integer('mtime_ms').notNull(),
		filePath: text('file_path').notNull(),
	},
	(table) => [
		index('sessions_project_id_idx').on(table.projectId),
		index('sessions_mtime_desc_idx').on(table.mtimeMs),
	],
);

export const planSessions = sqliteTable(
	'plan_sessions',
	{
		planFilename: text('plan_filename').notNull(),
		sessionId: text('session_id').notNull(),
		projectId: text('project_id').notNull(),
	},
	(table) => [
		primaryKey({columns: [table.planFilename, table.sessionId]}),
		index('plan_sessions_plan_idx').on(table.planFilename),
		index('plan_sessions_session_idx').on(table.sessionId),
	],
);

export const subagents = sqliteTable(
	'subagents',
	{
		id: text('id').primaryKey(),
		sessionId: text('session_id').notNull(),
		projectId: text('project_id').notNull(),
		agentType: text('agent_type'),
		slug: text('slug'),
		filePath: text('file_path').notNull(),
		mtimeMs: integer('mtime_ms').notNull(),
	},
	(table) => [index('subagents_session_idx').on(table.sessionId)],
);

export const starredSessions = sqliteTable('starred_sessions', {
	sessionId: text('session_id').primaryKey(),
	starredAt: integer('starred_at').notNull(),
});

export const summaries = sqliteTable('summaries', {
	sessionId: text('session_id').primaryKey(),
	lastMessageId: text('last_message_id').notNull(),
	summary: text('summary').notNull(),
	generatedAt: integer('generated_at').notNull(),
});
