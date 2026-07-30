import { eq, desc, sql, and, inArray, isNotNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import type { SessionEntry } from "../sessions";

type IndexDb = BetterSQLite3Database<typeof schema>;

function getProjectNameMap(db: IndexDb): Map<string, string> {
  const rows = db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .all();
  return new Map(rows.map((r) => [r.id, r.name]));
}

type SessionRow = typeof schema.sessions.$inferSelect;

function rowToSessionEntry(row: SessionRow, projectNames: Map<string, string>): SessionEntry {
  return {
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
    cwd: row.cwd ?? undefined,
    isSidechain: row.isSidechain === 1,
  };
}

// ---------------------------------------------------------------------------
// Batch session lookup helper
// ---------------------------------------------------------------------------

function batchFetchSessionTitles(db: IndexDb, sessionIds: string[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  if (sessionIds.length === 0) return map;
  const rows = db
    .select({ id: schema.sessions.id, title: schema.sessions.title })
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
  const rows = db
    .select()
    .from(schema.sessions)
    .where(inArray(schema.sessions.id, sessionIds))
    .all();
  return new Map(rows.map((r) => [r.id, r]));
}

interface DbProjectSummary {
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

/**
 * A flat, mtime-descending cursor into the sessions list. Pagination compares
 * on (mtimeMs, id) so ties on mtimeMs never drop or duplicate rows at a page
 * boundary.
 */
export interface SessionCursor {
  mtimeMs: number;
  id: string;
}

export interface RecentSessionsPage {
  sessions: SessionEntry[];
  nextCursor: SessionCursor | null;
}

/**
 * Most-recently-modified sessions across all projects (sidechains excluded),
 * page by page. Pass the previous page's `nextCursor` as `before` to continue.
 */
export function listRecentSessionsFromDb(
  db: IndexDb,
  opts: { limit: number; before?: SessionCursor },
): RecentSessionsPage {
  const { limit, before } = opts;
  const condition = before
    ? and(
        eq(schema.sessions.isSidechain, 0),
        sql`(${schema.sessions.mtimeMs} < ${before.mtimeMs} OR (${schema.sessions.mtimeMs} = ${before.mtimeMs} AND ${schema.sessions.id} < ${before.id}))`,
      )
    : eq(schema.sessions.isSidechain, 0);

  const rows = db
    .select()
    .from(schema.sessions)
    .where(condition)
    .orderBy(desc(schema.sessions.mtimeMs), desc(schema.sessions.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const projectNames = getProjectNameMap(db);
  const sessions = page.map((row) => rowToSessionEntry(row, projectNames));
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? { mtimeMs: last.mtimeMs, id: last.id } : null;
  return { sessions, nextCursor };
}

export interface SessionGroupSummary {
  project: string;
  projectName: string;
  /** Total non-sidechain sessions in the project (not just the returned slice). */
  sessionCount: number;
  sessions: SessionEntry[];
}

const DEFAULT_PER_PROJECT = 10;

/**
 * Sessions grouped by project for the "By Project" view: each group holds only
 * its `perProject` most-recent sessions plus the full `sessionCount`, so the UI
 * can show "N more" without loading every row.
 */
export function listSessionGroupsFromDb(
  db: IndexDb,
  opts: { perProject?: number } = {},
): SessionGroupSummary[] {
  const perProject = opts.perProject ?? DEFAULT_PER_PROJECT;
  const projectNames = getProjectNameMap(db);

  const stats = db
    .select({
      projectId: schema.sessions.projectId,
      count: sql<number>`count(*)`,
      maxMtime: sql<number>`max(${schema.sessions.mtimeMs})`,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.isSidechain, 0))
    .groupBy(schema.sessions.projectId)
    .all();
  const statByProject = new Map(stats.map((s) => [s.projectId, s]));

  // Top-N per project via a window function, ordered so rows arrive grouped by
  // project and newest-first within each project.
  const cappedRows = db.all(
    sql`SELECT id FROM (
          SELECT id, project_id,
                 row_number() OVER (PARTITION BY project_id ORDER BY mtime_ms DESC, id DESC) AS rn
          FROM sessions
          WHERE is_sidechain = 0
        ) WHERE rn <= ${perProject}
        ORDER BY project_id, rn`,
  ) as Array<{ id: string }>;

  const sessionMap = batchFetchSessions(
    db,
    cappedRows.map((r) => r.id),
  );

  const grouped = new Map<string, SessionEntry[]>();
  for (const { id } of cappedRows) {
    const row = sessionMap.get(id);
    if (!row) continue;
    const entry = rowToSessionEntry(row, projectNames);
    const list = grouped.get(row.projectId);
    if (list) list.push(entry);
    else grouped.set(row.projectId, [entry]);
  }

  const groups: SessionGroupSummary[] = [];
  for (const [project, sessions] of grouped) {
    groups.push({
      project,
      projectName: projectNames.get(project) ?? project,
      sessionCount: statByProject.get(project)?.count ?? sessions.length,
      sessions,
    });
  }

  groups.sort(
    (a, b) =>
      (statByProject.get(b.project)?.maxMtime ?? 0) - (statByProject.get(a.project)?.maxMtime ?? 0),
  );
  return groups;
}

/** Map of session id -> title for the given ids (unknown ids are omitted). */
export function getSessionTitlesByIds(db: IndexDb, ids: string[]): Record<string, string> {
  const titles = batchFetchSessionTitles(db, ids);
  const out: Record<string, string> = {};
  for (const [id, title] of titles) {
    if (title != null) out[id] = title;
  }
  return out;
}

export function listSessionsForProjectFromDb(db: IndexDb, projectId: string): SessionEntry[] {
  const projectRow = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
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
    cwd: row.cwd ?? undefined,
    isSidechain: false,
  }));
}

interface DbBranchSummary {
  branch: string;
  sessionCount: number;
  lastActivity: number;
}

export function listBranchesForProject(db: IndexDb, projectId: string): DbBranchSummary[] {
  const rows = db
    .select({
      branch: schema.sessions.gitBranch,
      sessionCount: sql<number>`count(*)`,
      lastActivity: sql<number>`max(${schema.sessions.mtimeMs})`,
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.projectId, projectId),
        eq(schema.sessions.isSidechain, 0),
        isNotNull(schema.sessions.gitBranch),
      ),
    )
    .groupBy(schema.sessions.gitBranch)
    .orderBy(desc(sql`max(${schema.sessions.mtimeMs})`))
    .all();

  return rows
    .filter((r): r is typeof r & { branch: string } => r.branch !== null)
    .map((r) => ({
      branch: r.branch,
      sessionCount: r.sessionCount,
      lastActivity: r.lastActivity,
    }));
}

export function listSessionsForBranch(
  db: IndexDb,
  projectId: string,
  branch: string,
): SessionEntry[] {
  const projectRow = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  const projectName = projectRow?.name ?? projectId;

  const rows = db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.projectId, projectId),
        eq(schema.sessions.isSidechain, 0),
        eq(schema.sessions.gitBranch, branch),
      ),
    )
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
    cwd: row.cwd ?? undefined,
    isSidechain: false,
  }));
}

interface DbCwdSummary {
  cwd: string;
  sessionCount: number;
  lastActivity: number;
}

export function listCwdsForProject(db: IndexDb, projectId: string): DbCwdSummary[] {
  const rows = db
    .select({
      cwd: schema.sessions.cwd,
      sessionCount: sql<number>`count(*)`,
      lastActivity: sql<number>`max(${schema.sessions.mtimeMs})`,
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.projectId, projectId),
        eq(schema.sessions.isSidechain, 0),
        isNotNull(schema.sessions.cwd),
      ),
    )
    .groupBy(schema.sessions.cwd)
    .orderBy(desc(sql`max(${schema.sessions.mtimeMs})`))
    .all();

  return rows
    .filter((r): r is typeof r & { cwd: string } => r.cwd !== null)
    .map((r) => ({
      cwd: r.cwd,
      sessionCount: r.sessionCount,
      lastActivity: r.lastActivity,
    }));
}

interface DbPlanSessionLink {
  planFilename: string;
  sessionId: string;
  projectId: string;
  projectName: string;
  sessionTitle: string | null;
}

export function getPlanFilenameForSession(db: IndexDb, sessionId: string): string | null {
  const row = db
    .select({ planFilename: schema.planSessions.planFilename })
    .from(schema.planSessions)
    .where(eq(schema.planSessions.sessionId, sessionId))
    .get();
  return row?.planFilename ?? null;
}

export function getPlanLinksFromDb(db: IndexDb, planFilename?: string): DbPlanSessionLink[] {
  const projectNames = getProjectNameMap(db);

  let rows;
  if (planFilename) {
    rows = db
      .select()
      .from(schema.planSessions)
      .where(eq(schema.planSessions.planFilename, planFilename))
      .all();
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

interface DbProjectDetail {
  id: string;
  name: string;
  projectPath: string | null;
  sessions: SessionEntry[];
  planLinks: DbPlanSessionLink[];
  subagentCount: number;
}

export function getProjectDetailFromDb(db: IndexDb, projectId: string): DbProjectDetail | null {
  const projectRow = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!projectRow) return null;

  const sessions = listSessionsForProjectFromDb(db, projectId);
  const planLinks = getPlanLinksForProjectFromDb(db, projectId);

  const subagentCount =
    db
      .select({ count: sql<number>`count(*)` })
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

  const rows = db
    .select()
    .from(schema.planSessions)
    .where(eq(schema.planSessions.projectId, projectId))
    .all();

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
    const snippet = row.title_snippet || row.summary_snippet || row.prompt_snippet || "";
    return {
      sessionId: row.session_id,
      title: row.title,
      firstPrompt: row.first_prompt || null,
      summary: row.summary || null,
      snippet,
      projectId: session?.projectId ?? "",
      projectName: session ? (projectNames.get(session.projectId) ?? session.projectId) : "",
      mtime: session ? new Date(session.mtimeMs).toISOString() : "",
      messageCount: session?.messageCount ?? 0,
      rank: row.rank,
    };
  });
}

export interface DbSubagent {
  id: string;
  sessionId: string;
  projectId: string;
  parentAgentId: string | null;
  agentType: string | null;
  slug: string | null;
  description: string | null;
  startedAt: string | null;
  finishedAt: string | null;
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

export function searchMessageContentDb(
  db: IndexDb,
  query: string,
  limit = 50,
): DbMessageSearchResult[] {
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
      projectId: session?.projectId ?? "",
      projectName: session ? (projectNames.get(session.projectId) ?? session.projectId) : "",
      mtime: session ? new Date(session.mtimeMs).toISOString() : "",
      messageCount: session?.messageCount ?? 0,
      rank: row.rank,
    };
  });
}

export function getSubagentById(db: IndexDb, agentId: string): DbSubagent | undefined {
  return db.select().from(schema.subagents).where(eq(schema.subagents.id, agentId)).get();
}

export function getSubagentsForSession(db: IndexDb, sessionId: string): DbSubagent[] {
  return db.select().from(schema.subagents).where(eq(schema.subagents.sessionId, sessionId)).all();
}

export function getSubagentsForProject(db: IndexDb, projectId: string): DbSubagent[] {
  return db.select().from(schema.subagents).where(eq(schema.subagents.projectId, projectId)).all();
}

export function isSessionStarred(db: IndexDb, sessionId: string): boolean {
  const row = db
    .select()
    .from(schema.starredSessions)
    .where(eq(schema.starredSessions.sessionId, sessionId))
    .get();
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
  db.insert(schema.starredSessions).values({ sessionId, starredAt: Date.now() }).run();
  return true;
}

export function setStar(db: IndexDb, sessionId: string, starred: boolean): boolean {
  const existing = db
    .select()
    .from(schema.starredSessions)
    .where(eq(schema.starredSessions.sessionId, sessionId))
    .get();
  if (starred) {
    if (!existing) {
      db.insert(schema.starredSessions).values({ sessionId, starredAt: Date.now() }).run();
    }
    return true;
  }
  if (existing) {
    db.delete(schema.starredSessions).where(eq(schema.starredSessions.sessionId, sessionId)).run();
  }
  return false;
}

export function getStarredSessionIds(db: IndexDb): Set<string> {
  const rows = db
    .select({ sessionId: schema.starredSessions.sessionId })
    .from(schema.starredSessions)
    .all();
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
    cwd: row.session.cwd ?? undefined,
    isSidechain: row.session.isSidechain === 1,
  }));
}

interface DbPlanProjectMapping {
  planFilename: string;
  projectId: string;
  projectName: string;
}

export function getSessionProjectId(db: IndexDb, sessionId: string): string | null {
  const row = db
    .select({ projectId: schema.sessions.projectId })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
  return row?.projectId ?? null;
}

export function getSessionProjectPath(db: IndexDb, sessionId: string): string | null {
  const row = db
    .select({ projectPath: schema.projects.projectPath })
    .from(schema.sessions)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.sessions.projectId))
    .where(eq(schema.sessions.id, sessionId))
    .get();
  return row?.projectPath ?? null;
}

export function getSessionMeta(
  db: IndexDb,
  sessionId: string,
): {
  gitBranch: string | null;
  cwd: string | null;
  messageCount: number;
  projectName: string | null;
} | null {
  const row = db
    .select({
      gitBranch: schema.sessions.gitBranch,
      cwd: schema.sessions.cwd,
      messageCount: schema.sessions.messageCount,
      projectId: schema.sessions.projectId,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
  if (!row) return null;
  const projectNames = getProjectNameMap(db);
  return {
    gitBranch: row.gitBranch,
    cwd: row.cwd,
    messageCount: row.messageCount,
    projectName: projectNames.get(row.projectId) ?? null,
  };
}

interface DbPlanListEntry {
  filename: string;
  title: string;
  mtimeMs: number;
}

export function listPlansFromDb(db: IndexDb): DbPlanListEntry[] {
  const rows = db
    .select({
      filename: schema.plans.filename,
      title: schema.plans.title,
      mtimeMs: schema.plans.mtimeMs,
    })
    .from(schema.plans)
    .orderBy(desc(schema.plans.mtimeMs))
    .all();

  return rows;
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
  owner: string | null;
  blocks: string[];
  blockedBy: string[];
  metadata: Record<string, unknown>;
}

interface TaskProjectGroup {
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
  owner: string | null;
  blocksJson: string;
  blockedByJson: string;
  metadataJson: string;
}): TaskRow {
  return {
    taskId: row.taskId,
    projectDir: row.projectDir,
    subject: row.subject,
    description: row.description,
    status: row.status,
    activeForm: row.activeForm,
    owner: row.owner,
    blocks: JSON.parse(row.blocksJson) as string[],
    blockedBy: JSON.parse(row.blockedByJson) as string[],
    metadata: JSON.parse(row.metadataJson) as Record<string, unknown>,
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
      owner: schema.tasks.owner,
      blocksJson: schema.tasks.blocksJson,
      blockedByJson: schema.tasks.blockedByJson,
      metadataJson: schema.tasks.metadataJson,
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
      owner: schema.tasks.owner,
      blocksJson: schema.tasks.blocksJson,
      blockedByJson: schema.tasks.blockedByJson,
      metadataJson: schema.tasks.metadataJson,
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
      if (t.status === "pending") totalPending++;
      if (t.status === "in_progress") totalInProgress++;
    }
    result.push({ projectDir, tasks, totalPending, totalInProgress });
  }

  return result;
}

export function getTaskCountsForProject(
  db: IndexDb,
  projectDir: string,
): { total: number; pending: number; inProgress: number; completed: number } {
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
    if (row.status === "pending") pending = row.count;
    else if (row.status === "in_progress") inProgress = row.count;
    else if (row.status === "completed") completed = row.count;
  }

  return { total, pending, inProgress, completed };
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

export interface MemoryRow {
  filename: string;
  title: string;
  mtimeMs: number;
}

export function getMemoryCountsForProjects(db: IndexDb): Map<string, number> {
  const rows = db
    .select({
      projectId: schema.memories.projectId,
      count: sql<number>`count(*)`,
    })
    .from(schema.memories)
    .groupBy(schema.memories.projectId)
    .all();

  return new Map(rows.map((r) => [r.projectId, r.count]));
}

export function getMemoriesForProject(db: IndexDb, projectId: string): MemoryRow[] {
  return db
    .select({
      filename: schema.memories.filename,
      title: schema.memories.title,
      mtimeMs: schema.memories.mtimeMs,
    })
    .from(schema.memories)
    .where(eq(schema.memories.projectId, projectId))
    .orderBy(desc(schema.memories.mtimeMs))
    .all();
}
