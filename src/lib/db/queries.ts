import { eq, desc, asc, sql, and, inArray, isNotNull, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { basename, dirname, relative, sep } from "node:path";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import type { SessionEntry } from "../sessions";

type IndexDb = BetterSQLite3Database<typeof schema>;

/** Distinct non-null project paths available as zero-config file-search roots. */
export function listFileSearchProjectPathsFromDb(db: IndexDb): string[] {
  return db
    .selectDistinct({ projectPath: schema.projects.projectPath })
    .from(schema.projects)
    .where(isNotNull(schema.projects.projectPath))
    .orderBy(asc(schema.projects.projectPath))
    .all()
    .flatMap((row) => (row.projectPath === null ? [] : [row.projectPath]));
}

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

export interface ContextBriefProject {
  id: string;
  name: string;
}

/** Resolve a hook cwd to the most recently indexed project with that exact path. */
export function getContextBriefProject(db: IndexDb, cwd: string): ContextBriefProject | null {
  const row = db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.projectPath, cwd))
    .orderBy(desc(schema.projects.updatedAt), asc(schema.projects.id))
    .get();
  return row ?? null;
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

/** Subset of `ids` that exist in the sessions table. */
export function getIndexedSessionIds(db: IndexDb, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const rows = db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(inArray(schema.sessions.id, ids))
    .all();
  return new Set(rows.map((row) => row.id));
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
  titleHtml: string;
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
  const terms = tokenizeFileSearchQuery(query);
  if (terms.length === 0) return [];

  const ftsQuery = toFtsQuery(terms);
  const projectNames = getProjectNameMap(db);

  const rows = db.all(
    sql`SELECT session_id, title, first_prompt, summary, rank,
				snippet(sessions_fts, 1, '<mark>', '</mark>', '...', 32) AS title_snippet,
				snippet(sessions_fts, 2, '<mark>', '</mark>', '...', 32) AS prompt_snippet,
				snippet(sessions_fts, 3, '<mark>', '</mark>', '...', 32) AS summary_snippet
			FROM sessions_fts
			WHERE sessions_fts MATCH ${ftsQuery}
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
    const secondary =
      differentiateSnippet(row.summary_snippet, row.title) ??
      differentiateSnippet(row.prompt_snippet, row.title);
    const snippet = secondary === null ? "" : sanitizeFtsSnippet(secondary);
    return {
      sessionId: row.session_id,
      title: row.title,
      titleHtml: sanitizeFtsSnippet(row.title_snippet),
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
  attributionAgent: string | null;
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
  const terms = tokenizeFileSearchQuery(query);
  if (terms.length === 0) return [];

  const ftsQuery = toFtsQuery(terms);
  const projectNames = getProjectNameMap(db);

  const rows = db.all(
    sql`SELECT session_id, rank,
				snippet(message_content_fts, 1, '<mark>', '</mark>', '...', 48) AS snippet
			FROM message_content_fts
			WHERE message_content_fts MATCH ${ftsQuery}
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
      snippet: sanitizeFtsSnippet(row.snippet),
      projectId: session?.projectId ?? "",
      projectName: session ? (projectNames.get(session.projectId) ?? session.projectId) : "",
      mtime: session ? new Date(session.mtimeMs).toISOString() : "",
      messageCount: session?.messageCount ?? 0,
      rank: row.rank,
    };
  });
}

export interface DbFileSearchMatch {
  lineNumber: number;
  snippet: string;
}

export interface DbFileSearchFile {
  path: string;
  matchCount: number;
  matches: DbFileSearchMatch[];
  mtime: string;
  rank: number;
}

export interface DbFileSearchResult {
  files: DbFileSearchFile[];
  totalResults: number;
  totalFiles: number;
  isTruncated: boolean;
}

interface FileSearchRow {
  path: string;
  highlighted_content: string;
  fallback_snippet: string;
  body_rank: number;
  mtime_ms: number;
}

interface FileSearchPathRow {
  path: string;
  mtime_ms: number;
}

const FILE_SEARCH_FILE_LIMIT = 100;
const FILE_SEARCH_MATCH_LIMIT = 50;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeFtsHighlight(value: string, highlightStart: string, highlightEnd: string): string {
  return escapeHtml(value).replaceAll(highlightStart, "<mark>").replaceAll(highlightEnd, "</mark>");
}

const MARK_OPEN = "<mark>";
const MARK_CLOSE = "</mark>";
const ELLIPSIS = "...";

function stripMarkTags(value: string): string {
  return value.replaceAll(MARK_OPEN, "").replaceAll(MARK_CLOSE, "");
}

/**
 * Turns a raw FTS snippet into a secondary line that adds information beyond
 * the result title. Returns null when the snippet has no highlighted match or
 * is only an echo of the title prefix (titles are derived from the first
 * prompt, so the leading prompt snippet often repeats the title verbatim).
 */
function differentiateSnippet(candidate: string, title: string): string | null {
  if (!candidate.includes(MARK_OPEN)) return null;

  const titlePrefix = title.endsWith(ELLIPSIS) ? title.slice(0, -ELLIPSIS.length) : title;
  if (!stripMarkTags(candidate).startsWith(titlePrefix)) return candidate;

  // Skip past the echoed title prefix, ignoring highlight tags along the way.
  let index = 0;
  let consumed = 0;
  while (index < candidate.length && consumed < titlePrefix.length) {
    if (candidate.startsWith(MARK_OPEN, index)) {
      index += MARK_OPEN.length;
    } else if (candidate.startsWith(MARK_CLOSE, index)) {
      index += MARK_CLOSE.length;
    } else {
      index++;
      consumed++;
    }
  }
  if (candidate.startsWith(MARK_CLOSE, index)) index += MARK_CLOSE.length;

  const remainder = candidate.slice(index).trim();
  if (!remainder.includes(MARK_OPEN)) return null;
  return ELLIPSIS + remainder;
}

function sanitizeFtsSnippet(value: string): string {
  return escapeHtml(value)
    .replaceAll("&lt;mark&gt;", "<mark>")
    .replaceAll("&lt;/mark&gt;", "</mark>");
}

function tokenizeFileSearchQuery(query: string): string[] {
  return query.normalize("NFKC").match(/[\p{L}\p{N}_]+/gu) ?? [];
}

function toFtsQuery(terms: readonly string[]): string {
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ");
}

function pathBoost(path: string, scopeRoot: string, terms: readonly string[]): number {
  const fileName = basename(path).toLowerCase();
  const directory = relative(scopeRoot, dirname(path)).toLowerCase();
  let boost = 0;
  for (const term of terms) {
    const normalizedTerm = term.toLowerCase();
    if (fileName.includes(normalizedTerm)) boost += 1_000;
    else if (directory.includes(normalizedTerm)) boost += 200;
  }
  return boost;
}

function boundedHighlightedLine(line: string, highlightStart: string): string {
  const trimmedLine = line.trimEnd();
  const tokens = trimmedLine.split(/\s+/);
  if (tokens.length <= 48) return trimmedLine;

  const matchIndex = tokens.findIndex((token) => token.includes(highlightStart));
  const startIndex = Math.max(0, Math.min(matchIndex - 24, tokens.length - 48));
  const endIndex = startIndex + 48;
  const prefix = startIndex > 0 ? "..." : "";
  const suffix = endIndex < tokens.length ? "..." : "";
  return `${prefix}${tokens.slice(startIndex, endIndex).join(" ")}${suffix}`;
}

function lineMatches(
  highlightedContent: string,
  fallbackSnippet: string,
  highlightStart: string,
  highlightEnd: string,
): DbFileSearchMatch[] {
  const matches: DbFileSearchMatch[] = [];
  const lines = highlightedContent.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.includes(highlightStart)) continue;
    matches.push({
      lineNumber: index + 1,
      snippet: sanitizeFtsHighlight(
        boundedHighlightedLine(line, highlightStart),
        highlightStart,
        highlightEnd,
      ),
    });
  }

  if (matches.length === 0 && fallbackSnippet.includes("<mark>")) {
    return [{ lineNumber: 1, snippet: sanitizeFtsSnippet(fallbackSnippet) }];
  }
  return matches;
}

/** Search indexed file contents within one already-authorized real directory. */
export function searchFileContentDb(
  db: IndexDb,
  query: string,
  scopeRoot: string,
): DbFileSearchResult {
  const terms = tokenizeFileSearchQuery(query);
  if (terms.length === 0) {
    return { files: [], totalResults: 0, totalFiles: 0, isTruncated: false };
  }

  const ftsQuery = toFtsQuery(terms);
  const scopePrefix = `${scopeRoot}${sep}`;
  const highlightIdentifier = randomUUID();
  const highlightStart = `\uE000${highlightIdentifier}-start\uE001`;
  const highlightEnd = `\uE000${highlightIdentifier}-end\uE001`;
  const rows = db.all(
    sql`SELECT file_content_fts.path AS path,
			highlight(file_content_fts, 1, ${highlightStart}, ${highlightEnd}) AS highlighted_content,
			snippet(file_content_fts, 1, '<mark>', '</mark>', '...', 48) AS fallback_snippet,
			bm25(file_content_fts) AS body_rank,
			COALESCE(indexed_files.mtime_ms, 0) AS mtime_ms
		FROM file_content_fts
		LEFT JOIN indexed_files ON indexed_files.path = 'file-content:' || file_content_fts.path
		WHERE file_content_fts MATCH ${ftsQuery}
			AND (file_content_fts.path = ${scopeRoot}
				OR substr(file_content_fts.path, 1, ${scopePrefix.length}) = ${scopePrefix})`,
  ) as FileSearchRow[];

  const rowsByPath = new Map(rows.map((row) => [row.path, row]));
  const pathRows = db.all(
    sql`SELECT file_content_fts.path AS path,
			COALESCE(indexed_files.mtime_ms, 0) AS mtime_ms
		FROM file_content_fts
		LEFT JOIN indexed_files ON indexed_files.path = 'file-content:' || file_content_fts.path
		WHERE file_content_fts.path = ${scopeRoot}
			OR substr(file_content_fts.path, 1, ${scopePrefix.length}) = ${scopePrefix}`,
  ) as FileSearchPathRow[];
  for (const row of pathRows) {
    const relativePath = relative(scopeRoot, row.path).toLowerCase();
    if (
      !rowsByPath.has(row.path) &&
      terms.every((term) => relativePath.includes(term.toLowerCase()))
    ) {
      rowsByPath.set(row.path, {
        ...row,
        highlighted_content: "",
        fallback_snippet: "",
        body_rank: 0,
      });
    }
  }

  const rankedFiles = [...rowsByPath.values()]
    .map((row) => {
      const allMatches = lineMatches(
        row.highlighted_content,
        row.fallback_snippet,
        highlightStart,
        highlightEnd,
      );
      return {
        path: row.path,
        matchCount: allMatches.length,
        matches: allMatches.slice(0, FILE_SEARCH_MATCH_LIMIT),
        mtime: new Date(row.mtime_ms).toISOString(),
        rank: row.body_rank - pathBoost(row.path, scopeRoot, terms),
      };
    })
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      const mtimeComparison = right.mtime.localeCompare(left.mtime);
      return mtimeComparison !== 0 ? mtimeComparison : left.path.localeCompare(right.path);
    });

  const totalResults = rankedFiles.reduce((total, file) => total + file.matchCount, 0);
  const isTruncated =
    rankedFiles.length > FILE_SEARCH_FILE_LIMIT ||
    rankedFiles.some((file) => file.matchCount > FILE_SEARCH_MATCH_LIMIT);

  return {
    files: rankedFiles.slice(0, FILE_SEARCH_FILE_LIMIT),
    totalResults,
    totalFiles: rankedFiles.length,
    isTruncated,
  };
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

/** Return the latest assistant text row that contains prose, skipping tool-only turns. */
export function getLastSubstantiveAssistantText(db: IndexDb, sessionId: string): string | null {
  const row = db
    .select({ text: schema.sessionMessages.text })
    .from(schema.sessionMessages)
    .where(
      and(
        eq(schema.sessionMessages.sessionId, sessionId),
        eq(schema.sessionMessages.role, "assistant"),
        sql`length(trim(${schema.sessionMessages.text})) > 0`,
      ),
    )
    .orderBy(desc(schema.sessionMessages.messageIndex))
    .get();
  return row?.text ?? null;
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

export function getRecentPlansForProject(
  db: IndexDb,
  projectId: string,
  limit: number,
): DbPlanListEntry[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Context brief plan limit must be a positive integer");
  }

  return db
    .selectDistinct({
      filename: schema.plans.filename,
      title: schema.plans.title,
      mtimeMs: schema.plans.mtimeMs,
    })
    .from(schema.plans)
    .innerJoin(schema.planSessions, eq(schema.planSessions.planFilename, schema.plans.filename))
    .where(eq(schema.planSessions.projectId, projectId))
    .orderBy(desc(schema.plans.mtimeMs), asc(schema.plans.filename))
    .limit(limit)
    .all();
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
  projectId: string;
  projectName: string;
  sessionId: string | null;
  sessionTitle: string;
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

/**
 * Return the raw task rows attributed to a project. Claude usually stores task
 * files under a session UUID, so tasks.projectDir joins sessions.id — but some
 * directories are a `session-<idprefix>` shorthand or a plain project name, so
 * unmatched rows fall back to resolveUnmatchedTaskDir. Every project-scoped
 * task reader must go through this function so the /projects card count, the
 * project detail list, and the /tasks grouping cannot disagree.
 */
function getRawTaskRowsForProject(db: IndexDb, projectId: string) {
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
      mtimeMs: schema.tasks.mtimeMs,
      sessionProjectId: schema.sessions.projectId,
    })
    .from(schema.tasks)
    .leftJoin(schema.sessions, eq(schema.sessions.id, schema.tasks.projectDir))
    .all();

  const resolvedDirProjects = new Map<string, string>();
  return rows.filter((row) => {
    if (row.sessionProjectId !== null) return row.sessionProjectId === projectId;
    let resolved = resolvedDirProjects.get(row.projectDir);
    if (resolved === undefined) {
      resolved = resolveUnmatchedTaskDir(db, row.projectDir).projectId;
      resolvedDirProjects.set(row.projectDir, resolved);
    }
    return resolved === projectId;
  });
}

/** Return all tasks attributed to a project, including completed tasks. */
export function getTasksForProject(db: IndexDb, projectId: string): TaskRow[] {
  return getRawTaskRowsForProject(db, projectId).map(parseTaskRow);
}

/** Return open tasks attributed to a project, in-progress first, newest first. */
export function getOpenTasksForProject(db: IndexDb, projectId: string, limit: number): TaskRow[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Context brief task limit must be a positive integer");
  }

  return getRawTaskRowsForProject(db, projectId)
    .filter((row) => row.status === "pending" || row.status === "in_progress")
    .sort(
      (left, right) =>
        Number(left.status !== "in_progress") - Number(right.status !== "in_progress") ||
        right.mtimeMs - left.mtimeMs ||
        left.taskId.localeCompare(right.taskId),
    )
    .slice(0, limit)
    .map(parseTaskRow);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_PREFIX_PATTERN = /^session-([0-9a-f]{4,})$/i;

interface ResolvedTaskDirLabels {
  projectId: string;
  projectName: string;
  sessionId: string | null;
  sessionTitle: string;
}

/**
 * Label a task directory whose name did not match any sessions.id. Directories
 * under ~/.claude/tasks/ are sometimes a `session-<idprefix>` shorthand, a
 * plain project name, or a session UUID with no surviving JSONL. Never returns
 * the same string for projectName and sessionTitle, so the /tasks page cannot
 * render one identifier twice.
 */
function resolveUnmatchedTaskDir(db: IndexDb, projectDir: string): ResolvedTaskDirLabels {
  const idPrefix = SESSION_PREFIX_PATTERN.exec(projectDir)?.[1];
  if (idPrefix !== undefined) {
    const candidates = db
      .select({
        sessionId: schema.sessions.id,
        projectId: schema.sessions.projectId,
        projectName: schema.projects.name,
        sessionTitle: sql<
          string | null
        >`coalesce(${schema.sessions.customTitle}, ${schema.sessions.title})`,
      })
      .from(schema.sessions)
      .leftJoin(schema.projects, eq(schema.projects.id, schema.sessions.projectId))
      .where(like(schema.sessions.id, `${idPrefix}%`))
      .limit(2)
      .all();
    const match = candidates.length === 1 ? candidates[0] : undefined;
    if (match) {
      return {
        projectId: match.projectId,
        projectName: match.projectName ?? match.projectId,
        sessionId: match.sessionId,
        sessionTitle: match.sessionTitle ?? `Session ${match.sessionId.slice(0, 8)}`,
      };
    }
  }
  if (idPrefix !== undefined || UUID_PATTERN.test(projectDir)) {
    const shortId = idPrefix ?? projectDir.slice(0, 8);
    return {
      projectId: "unknown",
      projectName: "Unknown project",
      sessionId: null,
      sessionTitle: `Session ${shortId}`,
    };
  }
  const projects = db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.name, projectDir))
    .limit(2)
    .all();
  const project = projects.length === 1 ? projects[0] : undefined;
  return {
    projectId: project?.id ?? projectDir,
    projectName: project?.name ?? projectDir,
    sessionId: null,
    sessionTitle: "Project tasks",
  };
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
      sessionId: schema.sessions.id,
      projectId: schema.sessions.projectId,
      projectName: schema.projects.name,
      sessionTitle: sql<
        string | null
      >`coalesce(${schema.sessions.customTitle}, ${schema.sessions.title})`,
    })
    .from(schema.tasks)
    .leftJoin(schema.sessions, eq(schema.sessions.id, schema.tasks.projectDir))
    .leftJoin(schema.projects, eq(schema.projects.id, schema.sessions.projectId))
    .where(sql`${schema.tasks.status} IN ('pending', 'in_progress')`)
    .all();

  const sessionMap = new Map<
    string,
    {
      projectId: string;
      projectName: string;
      sessionId: string | null;
      sessionTitle: string;
      tasks: TaskRow[];
    }
  >();
  for (const row of rows) {
    const task = parseTaskRow(row);
    let session = sessionMap.get(row.projectDir);
    if (!session) {
      const labels: ResolvedTaskDirLabels =
        row.sessionId !== null && row.projectId !== null
          ? {
              projectId: row.projectId,
              projectName: row.projectName ?? row.projectId,
              sessionId: row.sessionId,
              sessionTitle: row.sessionTitle ?? `Session ${row.sessionId.slice(0, 8)}`,
            }
          : resolveUnmatchedTaskDir(db, row.projectDir);
      session = { ...labels, tasks: [] };
      sessionMap.set(row.projectDir, session);
    }
    session.tasks.push(task);
  }

  const result: TaskProjectGroup[] = [];
  for (const [projectDir, session] of sessionMap) {
    let totalPending = 0;
    let totalInProgress = 0;
    for (const task of session.tasks) {
      if (task.status === "pending") totalPending++;
      if (task.status === "in_progress") totalInProgress++;
    }
    result.push({
      projectDir,
      projectId: session.projectId,
      projectName: session.projectName,
      sessionId: session.sessionId,
      sessionTitle: session.sessionTitle,
      tasks: session.tasks,
      totalPending,
      totalInProgress,
    });
  }

  return result;
}

export function getTaskCountsForProject(
  db: IndexDb,
  projectId: string,
): { total: number; pending: number; inProgress: number; completed: number } {
  let total = 0;
  let pending = 0;
  let inProgress = 0;
  let completed = 0;
  for (const row of getRawTaskRowsForProject(db, projectId)) {
    total++;
    if (row.status === "pending") pending++;
    else if (row.status === "in_progress") inProgress++;
    else if (row.status === "completed") completed++;
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
    .orderBy(desc(schema.memories.mtimeMs), asc(schema.memories.filename))
    .all();
}
