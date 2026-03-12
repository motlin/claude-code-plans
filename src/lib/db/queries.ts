import {eq, desc, sql, and} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import type {SessionEntry, SessionProjectGroup} from '../sessions';

type IndexDb = BetterSQLite3Database<typeof schema>;

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
	const projectNames = new Map<string, string>();

	// Get project names
	const projectRows = db.select().from(schema.projects).all();
	for (const p of projectRows) {
		projectNames.set(p.id, p.name);
	}

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
}

export function getPlanLinksFromDb(db: IndexDb, planFilename?: string): DbPlanSessionLink[] {
	const projectRows = db.select().from(schema.projects).all();
	const projectNames = new Map(projectRows.map((p) => [p.id, p.name]));

	let rows;
	if (planFilename) {
		rows = db.select().from(schema.planSessions).where(eq(schema.planSessions.planFilename, planFilename)).all();
	} else {
		rows = db.select().from(schema.planSessions).all();
	}

	return rows.map((row) => ({
		planFilename: row.planFilename,
		sessionId: row.sessionId,
		projectId: row.projectId,
		projectName: projectNames.get(row.projectId) ?? row.projectId,
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
	const projectRow = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
	const projectName = projectRow?.name ?? projectId;

	const rows = db.select().from(schema.planSessions).where(eq(schema.planSessions.projectId, projectId)).all();

	return rows.map((row) => ({
		planFilename: row.planFilename,
		sessionId: row.sessionId,
		projectId: row.projectId,
		projectName,
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
	rank: number;
}

export function searchSessionsFromDb(db: IndexDb, query: string): DbSearchResult[] {
	const projectRows = db.select().from(schema.projects).all();
	const projectNames = new Map(projectRows.map((p) => [p.id, p.name]));

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

	return rows.map((row) => {
		const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, row.session_id)).get();
		const snippet = row.title_snippet || row.summary_snippet || row.prompt_snippet || '';
		return {
			sessionId: row.session_id,
			title: row.title,
			firstPrompt: row.first_prompt || null,
			summary: row.summary || null,
			snippet,
			projectId: session?.projectId ?? '',
			projectName: session ? (projectNames.get(session.projectId) ?? session.projectId) : '',
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

export function getSubagentsForSession(db: IndexDb, sessionId: string): DbSubagent[] {
	return db.select().from(schema.subagents).where(eq(schema.subagents.sessionId, sessionId)).all();
}
