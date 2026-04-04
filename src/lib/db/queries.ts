import {eq, desc, sql, and, inArray} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import type {SessionEntry, SessionProjectGroup} from '../sessions';

type IndexDb = BetterSQLite3Database<typeof schema>;

// ---------------------------------------------------------------------------
// Cached project name map (avoids 6+ redundant full-table scans per request)
// ---------------------------------------------------------------------------

let cachedProjectNames: {map: Map<string, string>; timestamp: number} | null = null;
const PROJECT_NAMES_TTL_MS = 10_000;

function getProjectNameMap(db: IndexDb): Map<string, string> {
	if (cachedProjectNames && Date.now() - cachedProjectNames.timestamp < PROJECT_NAMES_TTL_MS) {
		return cachedProjectNames.map;
	}
	const rows = db.select({id: schema.projects.id, name: schema.projects.name}).from(schema.projects).all();
	const map = new Map(rows.map((r) => [r.id, r.name]));
	cachedProjectNames = {map, timestamp: Date.now()};
	return map;
}

// ---------------------------------------------------------------------------
// Batch session lookup helper
// ---------------------------------------------------------------------------

function batchFetchSessionTitles(db: IndexDb, sessionIds: string[]): Map<string, string | null> {
	const map = new Map<string, string | null>();
	if (sessionIds.length === 0) return map;
	const rows = db
		.select({id: schema.sessions.id, title: schema.sessions.title})
		.from(schema.sessions)
		.where(inArray(schema.sessions.id, sessionIds))
		.all();
	for (const r of rows) {
		map.set(r.id, r.title);
	}
	return map;
}

function batchFetchSessions(db: IndexDb, sessionIds: string[]) {
	if (sessionIds.length === 0) return new Map<string, typeof schema.sessions.$inferSelect>();
	const rows = db.select().from(schema.sessions).where(inArray(schema.sessions.id, sessionIds)).all();
	return new Map(rows.map((r) => [r.id, r]));
}

export interface DbProjectSummary {
	id: string;
	name: string;
	projectPath: string | null;
	sessionCount: number;
	lastActivity: number;
}

export function listProjectsFromDb(db: IndexDb): DbProjectSummary[] {
	const rows = db
		.select({
			id: schema.projects.id,
			name: schema.projects.name,
			projectPath: schema.projects.projectPath,
			sessionCount: sql<number>`count(case when ${schema.sessions.isSidechain} = 0 then 1 end)`,
			lastActivity: sql<number>`coalesce(max(${schema.sessions.mtimeMs}), ${schema.projects.updatedAt})`,
		})
		.from(schema.projects)
		.leftJoin(schema.sessions, eq(schema.sessions.projectId, schema.projects.id))
		.groupBy(schema.projects.id)
		.orderBy(desc(sql`coalesce(max(${schema.sessions.mtimeMs}), ${schema.projects.updatedAt})`))
		.all();

	return rows;
}

export function listSessionsFromDb(db: IndexDb): SessionProjectGroup[] {
	const rows = db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.isSidechain, 0))
		.orderBy(desc(schema.sessions.mtimeMs))
		.all();

	const projectMap = new Map<string, SessionEntry[]>();
	const projectNames = getProjectNameMap(db);

	for (const row of rows) {
		const entry: SessionEntry = {
			id: row.id,
			title: row.title,
			firstPrompt: row.firstPrompt ?? undefined,
			summary: row.summary ?? undefined,
			customTitle: row.customTitle ?? undefined,
			mtime: new Date(row.mtimeMs),
			created: new Date(row.createdAt),
			project: row.projectId,
			projectName: projectNames.get(row.projectId) ?? row.projectId,
			messageCount: row.messageCount,
			gitBranch: row.gitBranch ?? undefined,
			isSidechain: false,
		};

		const list = projectMap.get(row.projectId);
		if (list) {
			list.push(entry);
		} else {
			projectMap.set(row.projectId, [entry]);
		}
	}

	const groups: SessionProjectGroup[] = [];
	for (const [project, sessions] of projectMap) {
		groups.push({
			project,
			projectName: projectNames.get(project) ?? project,
			sessions,
		});
	}

	// Sort groups by max mtime
	groups.sort((a, b) => {
		const aMax = Math.max(...a.sessions.map((s) => s.mtime.getTime()));
		const bMax = Math.max(...b.sessions.map((s) => s.mtime.getTime()));
		return bMax - aMax;
	});

	return groups;
}

export function listSessionsForProjectFromDb(db: IndexDb, projectId: string): SessionEntry[] {
	const projectRow = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
	const projectName = projectRow?.name ?? projectId;

	const rows = db
		.select()
		.from(schema.sessions)
		.where(and(eq(schema.sessions.projectId, projectId), eq(schema.sessions.isSidechain, 0)))
		.orderBy(desc(schema.sessions.mtimeMs))
		.all();

	return rows.map((row) => ({
		id: row.id,
		title: row.title,
		firstPrompt: row.firstPrompt ?? undefined,
		summary: row.summary ?? undefined,
		customTitle: row.customTitle ?? undefined,
		mtime: new Date(row.mtimeMs),
		created: new Date(row.createdAt),
		project: row.projectId,
		projectName,
		messageCount: row.messageCount,
		gitBranch: row.gitBranch ?? undefined,
		isSidechain: false,
	}));
}

export interface DbPlanSessionLink {
	planFilename: string;
	sessionId: string;
	projectId: string;
	projectName: string;
	sessionTitle: string | null;
}

export function getPlanLinksFromDb(db: IndexDb, planFilename?: string): DbPlanSessionLink[] {
	const projectNames = getProjectNameMap(db);

	let rows;
	if (planFilename) {
		rows = db.select().from(schema.planSessions).where(eq(schema.planSessions.planFilename, planFilename)).all();
	} else {
		rows = db.select().from(schema.planSessions).all();
	}

	const sessionTitles = batchFetchSessionTitles(
		db,
		rows.map((r) => r.sessionId),
	);

	return rows.map((row) => ({
		planFilename: row.planFilename,
		sessionId: row.sessionId,
		projectId: row.projectId,
		projectName: projectNames.get(row.projectId) ?? row.projectId,
		sessionTitle: sessionTitles.get(row.sessionId) ?? null,
	}));
}

export interface DbProjectDetail {
	id: string;
	name: string;
	projectPath: string | null;
	sessions: SessionEntry[];
	planLinks: DbPlanSessionLink[];
	subagentCount: number;
}

export function getProjectDetailFromDb(db: IndexDb, projectId: string): DbProjectDetail | null {
	const projectRow = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
	if (!projectRow) return null;

	const sessions = listSessionsForProjectFromDb(db, projectId);
	const planLinks = getPlanLinksForProjectFromDb(db, projectId);

	const subagentCount =
		db
			.select({count: sql<number>`count(*)`})
			.from(schema.subagents)
			.where(eq(schema.subagents.projectId, projectId))
			.get()?.count ?? 0;

	return {
		id: projectRow.id,
		name: projectRow.name,
		projectPath: projectRow.projectPath,
		sessions,
		planLinks,
		subagentCount,
	};
}

function getPlanLinksForProjectFromDb(db: IndexDb, projectId: string): DbPlanSessionLink[] {
	const projectNames = getProjectNameMap(db);
	const projectName = projectNames.get(projectId) ?? projectId;

	const rows = db.select().from(schema.planSessions).where(eq(schema.planSessions.projectId, projectId)).all();

	const sessionTitles = batchFetchSessionTitles(
		db,
		rows.map((r) => r.sessionId),
	);

	return rows.map((row) => ({
		planFilename: row.planFilename,
		sessionId: row.sessionId,
		projectId: row.projectId,
		projectName,
		sessionTitle: sessionTitles.get(row.sessionId) ?? null,
	}));
}

export interface DbSearchResult {
	sessionId: string;
	title: string;
	firstPrompt: string | null;
	summary: string | null;
	snippet: string;
	projectId: string;
	projectName: string;
	mtime: string;
	messageCount: number;
	rank: number;
}

export function searchSessionsFromDb(db: IndexDb, query: string): DbSearchResult[] {
	const projectNames = getProjectNameMap(db);

	const rows = db.all(
		sql`SELECT session_id, title, first_prompt, summary, rank,
				snippet(sessions_fts, 1, '<mark>', '</mark>', '...', 32) AS title_snippet,
				snippet(sessions_fts, 2, '<mark>', '</mark>', '...', 32) AS prompt_snippet,
				snippet(sessions_fts, 3, '<mark>', '</mark>', '...', 32) AS summary_snippet
			FROM sessions_fts
			WHERE sessions_fts MATCH ${query}
			ORDER BY rank
			LIMIT 50`,
	) as Array<{
		session_id: string;
		title: string;
		first_prompt: string;
		summary: string;
		rank: number;
		title_snippet: string;
		prompt_snippet: string;
		summary_snippet: string;
	}>;

	const sessionMap = batchFetchSessions(
		db,
		rows.map((r) => r.session_id),
	);

	return rows.map((row) => {
		const session = sessionMap.get(row.session_id);
		const snippet = row.title_snippet || row.summary_snippet || row.prompt_snippet || '';
		return {
			sessionId: row.session_id,
			title: row.title,
			firstPrompt: row.first_prompt || null,
			summary: row.summary || null,
			snippet,
			projectId: session?.projectId ?? '',
			projectName: session ? (projectNames.get(session.projectId) ?? session.projectId) : '',
			mtime: session ? new Date(session.mtimeMs).toISOString() : '',
			messageCount: session?.messageCount ?? 0,
			rank: row.rank,
		};
	});
}

export interface DbSubagent {
	id: string;
	sessionId: string;
	projectId: string;
	agentType: string | null;
	slug: string | null;
	filePath: string;
	mtimeMs: number;
}

export interface DbMessageSearchResult {
	sessionId: string;
	title: string;
	snippet: string;
	projectId: string;
	projectName: string;
	mtime: string;
	messageCount: number;
	rank: number;
}

export function searchMessageContent(db: IndexDb, query: string, limit = 50): DbMessageSearchResult[] {
	const projectNames = getProjectNameMap(db);

	const rows = db.all(
		sql`SELECT session_id, rank,
				snippet(message_content_fts, 1, '<mark>', '</mark>', '...', 48) AS snippet
			FROM message_content_fts
			WHERE message_content_fts MATCH ${query}
			ORDER BY rank
			LIMIT ${limit}`,
	) as Array<{
		session_id: string;
		rank: number;
		snippet: string;
	}>;

	const sessionMap = batchFetchSessions(
		db,
		rows.map((r) => r.session_id),
	);

	return rows.map((row) => {
		const session = sessionMap.get(row.session_id);
		return {
			sessionId: row.session_id,
			title: session?.title ?? row.session_id,
			snippet: row.snippet,
			projectId: session?.projectId ?? '',
			projectName: session ? (projectNames.get(session.projectId) ?? session.projectId) : '',
			mtime: session ? new Date(session.mtimeMs).toISOString() : '',
			messageCount: session?.messageCount ?? 0,
			rank: row.rank,
		};
	});
}

export function getSubagentsForSession(db: IndexDb, sessionId: string): DbSubagent[] {
	return db.select().from(schema.subagents).where(eq(schema.subagents.sessionId, sessionId)).all();
}

export function isSessionStarred(db: IndexDb, sessionId: string): boolean {
	const row = db.select().from(schema.starredSessions).where(eq(schema.starredSessions.sessionId, sessionId)).get();
	return !!row;
}

export function toggleStar(db: IndexDb, sessionId: string): boolean {
	const existing = db
		.select()
		.from(schema.starredSessions)
		.where(eq(schema.starredSessions.sessionId, sessionId))
		.get();
	if (existing) {
		db.delete(schema.starredSessions).where(eq(schema.starredSessions.sessionId, sessionId)).run();
		return false;
	}
	db.insert(schema.starredSessions).values({sessionId, starredAt: Date.now()}).run();
	return true;
}

export function getStarredSessionIds(db: IndexDb): Set<string> {
	const rows = db.select({sessionId: schema.starredSessions.sessionId}).from(schema.starredSessions).all();
	return new Set(rows.map((r) => r.sessionId));
}

export function getStarredSessions(db: IndexDb): SessionEntry[] {
	const projectNames = getProjectNameMap(db);

	const rows = db
		.select({
			session: schema.sessions,
			starredAt: schema.starredSessions.starredAt,
		})
		.from(schema.starredSessions)
		.innerJoin(schema.sessions, eq(schema.sessions.id, schema.starredSessions.sessionId))
		.orderBy(desc(schema.starredSessions.starredAt))
		.all();

	return rows.map((row) => ({
		id: row.session.id,
		title: row.session.title,
		firstPrompt: row.session.firstPrompt ?? undefined,
		summary: row.session.summary ?? undefined,
		customTitle: row.session.customTitle ?? undefined,
		mtime: new Date(row.session.mtimeMs),
		created: new Date(row.session.createdAt),
		project: row.session.projectId,
		projectName: projectNames.get(row.session.projectId) ?? row.session.projectId,
		messageCount: row.session.messageCount,
		gitBranch: row.session.gitBranch ?? undefined,
		isSidechain: row.session.isSidechain === 1,
	}));
}

export interface DbPlanProjectMapping {
	planFilename: string;
	projectId: string;
	projectName: string;
}

export function getSessionProjectPath(db: IndexDb, sessionId: string): string | null {
	const row = db
		.select({projectPath: schema.projects.projectPath})
		.from(schema.sessions)
		.innerJoin(schema.projects, eq(schema.projects.id, schema.sessions.projectId))
		.where(eq(schema.sessions.id, sessionId))
		.get();
	return row?.projectPath ?? null;
}

export function getSessionMeta(
	db: IndexDb,
	sessionId: string,
): {gitBranch: string | null; messageCount: number} | null {
	const row = db
		.select({
			gitBranch: schema.sessions.gitBranch,
			messageCount: schema.sessions.messageCount,
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.get();
	return row ?? null;
}

export function getPlanProjectMappings(db: IndexDb): DbPlanProjectMapping[] {
	const projectNames = getProjectNameMap(db);

	const rows = db
		.selectDistinct({
			planFilename: schema.planSessions.planFilename,
			projectId: schema.planSessions.projectId,
		})
		.from(schema.planSessions)
		.all();

	return rows.map((row) => ({
		planFilename: row.planFilename,
		projectId: row.projectId,
		projectName: projectNames.get(row.projectId) ?? row.projectId,
	}));
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface TaskRow {
	taskId: string;
	projectDir: string;
	subject: string;
	description: string;
	status: string;
	activeForm: string | null;
	blocks: string[];
	blockedBy: string[];
}

export interface TaskProjectGroup {
	projectDir: string;
	tasks: TaskRow[];
	totalPending: number;
	totalInProgress: number;
}

function parseTaskRow(row: {
	taskId: string;
	projectDir: string;
	subject: string;
	description: string;
	status: string;
	activeForm: string | null;
	blocksJson: string;
	blockedByJson: string;
}): TaskRow {
	return {
		taskId: row.taskId,
		projectDir: row.projectDir,
		subject: row.subject,
		description: row.description,
		status: row.status,
		activeForm: row.activeForm,
		blocks: JSON.parse(row.blocksJson) as string[],
		blockedBy: JSON.parse(row.blockedByJson) as string[],
	};
}

export function getTasksForProject(db: IndexDb, projectDir: string): TaskRow[] {
	const rows = db
		.select({
			taskId: schema.tasks.taskId,
			projectDir: schema.tasks.projectDir,
			subject: schema.tasks.subject,
			description: schema.tasks.description,
			status: schema.tasks.status,
			activeForm: schema.tasks.activeForm,
			blocksJson: schema.tasks.blocksJson,
			blockedByJson: schema.tasks.blockedByJson,
		})
		.from(schema.tasks)
		.where(eq(schema.tasks.projectDir, projectDir))
		.all();

	return rows.map(parseTaskRow);
}

export function getIncompleteTasksGroupedByProject(db: IndexDb): TaskProjectGroup[] {
	const rows = db
		.select({
			taskId: schema.tasks.taskId,
			projectDir: schema.tasks.projectDir,
			subject: schema.tasks.subject,
			description: schema.tasks.description,
			status: schema.tasks.status,
			activeForm: schema.tasks.activeForm,
			blocksJson: schema.tasks.blocksJson,
			blockedByJson: schema.tasks.blockedByJson,
		})
		.from(schema.tasks)
		.where(sql`${schema.tasks.status} IN ('pending', 'in_progress')`)
		.all();

	const projectMap = new Map<string, TaskRow[]>();
	for (const row of rows) {
		const task = parseTaskRow(row);
		let list = projectMap.get(row.projectDir);
		if (!list) {
			list = [];
			projectMap.set(row.projectDir, list);
		}
		list.push(task);
	}

	const result: TaskProjectGroup[] = [];
	for (const [projectDir, tasks] of projectMap) {
		let totalPending = 0;
		let totalInProgress = 0;
		for (const t of tasks) {
			if (t.status === 'pending') totalPending++;
			if (t.status === 'in_progress') totalInProgress++;
		}
		result.push({projectDir, tasks, totalPending, totalInProgress});
	}

	return result;
}

export function getTaskCountsForProject(
	db: IndexDb,
	projectDir: string,
): {total: number; pending: number; inProgress: number; completed: number} {
	const rows = db
		.select({
			status: schema.tasks.status,
			count: sql<number>`count(*)`,
		})
		.from(schema.tasks)
		.where(eq(schema.tasks.projectDir, projectDir))
		.groupBy(schema.tasks.status)
		.all();

	let total = 0;
	let pending = 0;
	let inProgress = 0;
	let completed = 0;
	for (const row of rows) {
		total += row.count;
		if (row.status === 'pending') pending = row.count;
		else if (row.status === 'in_progress') inProgress = row.count;
		else if (row.status === 'completed') completed = row.count;
	}

	return {total, pending, inProgress, completed};
}
