import {randomUUID} from "node:crypto";
import {basename, relative, sep} from "node:path";
import {sql, type SQL} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import type {UnifiedSearchDate, UnifiedSearchItem, UnifiedSearchParams} from "../api/search";
import {toMdSlug} from "../md-slug";
import type {Snippet, TextMatch} from "../search-text";
import {searchMessageContentSessions, toFtsQuery, tokenizeFileSearchQuery} from "./queries";
import type * as schema from "./schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

const SNIPPET_TOKENS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Sentinels {
	open: string;
	close: string;
}

interface ProjectRow {
	id: string;
	name: string;
	project_path: string | null;
}

interface TitleHitRow {
	session_id: string;
	project_id: string;
	mtime_ms: number;
	title_highlight: string;
	prompt_snippet: string;
	summary_snippet: string;
}

interface MessageHitRow {
	session_id: string;
	project_id: string;
	mtime_ms: number;
	title: string;
	message_snippet: string;
}

interface DocHitRow {
	path: string;
	kind: "plan" | "memory";
	project_id: string;
	mtime_ms: number;
	title_highlight: string;
	content_snippet: string;
}

interface FileHitRow {
	path: string;
	file_snippet: string;
	mtime_ms: number;
}

/**
 * Converts FTS5 `highlight()`/`snippet()` output delimited by `sentinels` into
 * plain text plus the matched ranges, as UTF-16 offsets into that text.
 */
function parseHighlighted(highlighted: string, sentinels: Sentinels): Snippet {
	let text = "";
	const matches: TextMatch[] = [];
	let index = 0;
	while (index < highlighted.length) {
		const openIndex = highlighted.indexOf(sentinels.open, index);
		if (openIndex === -1) break;
		const closeIndex = highlighted.indexOf(sentinels.close, openIndex + sentinels.open.length);
		if (closeIndex === -1) break;
		text += highlighted.slice(index, openIndex);
		const start = text.length;
		text += highlighted.slice(openIndex + sentinels.open.length, closeIndex);
		matches.push({start, end: text.length});
		index = closeIndex + sentinels.close.length;
	}
	text += highlighted.slice(index);
	return {text, matches};
}

function escapeRegExp(value: string): string {
	return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive, non-overlapping occurrences of any term in `text`. */
function substringMatches(text: string, terms: readonly string[]): TextMatch[] {
	if (terms.length === 0) return [];
	const pattern = new RegExp(terms.map(escapeRegExp).join("|"), "giu");
	const matches: TextMatch[] = [];
	for (const match of text.matchAll(pattern)) {
		matches.push({start: match.index, end: match.index + match[0].length});
	}
	return matches;
}

function dateCutoff(date: UnifiedSearchDate | undefined, now: number): number | null {
	if (date === undefined) return null;
	if (date === "today") {
		const today = new Date(now);
		return new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
	}
	return now - (date === "week" ? 7 : 30) * DAY_MS;
}

function sessionFilters(project: string | undefined, cutoff: number | null): SQL {
	const projectFilter = project === undefined ? sql`` : sql` AND s.project_id = ${project}`;
	const dateFilter = cutoff === null ? sql`` : sql` AND s.mtime_ms >= ${cutoff}`;
	return sql`${projectFilter}${dateFilter}`;
}

function usableSnippet(highlighted: string, title: string, sentinels: Sentinels): Snippet | null {
	const snippet = parseHighlighted(highlighted, sentinels);
	if (snippet.matches.length === 0 || snippet.text === title) return null;
	return snippet;
}

function searchSessions(
	db: IndexDb,
	ftsQuery: string,
	terms: readonly string[],
	params: UnifiedSearchParams,
	cutoff: number | null,
	projectNames: Map<string, string>,
	sentinels: Sentinels,
): UnifiedSearchItem[] {
	const filters = sessionFilters(params.project, cutoff);
	const {open, close} = sentinels;

	const titleRows = db.all(
		sql`SELECT s.id AS session_id, s.project_id, s.mtime_ms,
				highlight(sessions_fts, 1, ${open}, ${close}) AS title_highlight,
				snippet(sessions_fts, 2, ${open}, ${close}, '...', ${SNIPPET_TOKENS}) AS prompt_snippet,
				snippet(sessions_fts, 3, ${open}, ${close}, '...', ${SNIPPET_TOKENS}) AS summary_snippet
			FROM sessions_fts
			JOIN sessions s ON s.id = sessions_fts.session_id
			WHERE sessions_fts MATCH ${ftsQuery}${filters}
			ORDER BY bm25(sessions_fts), s.mtime_ms DESC
			LIMIT ${params.limit}`,
	) as TitleHitRow[];

	const messageHits = searchMessageContentSessions(db, terms, {
		sessionFilters: sql` AND s.id IS NOT NULL${filters}`,
		limit: params.limit + titleRows.length,
		snippet: {open, close, tokens: SNIPPET_TOKENS},
	});
	const messageRows: MessageHitRow[] = messageHits.map((hit) => ({
		session_id: hit.session_id,
		project_id: hit.project_id ?? "",
		mtime_ms: hit.mtime_ms ?? 0,
		title: hit.title ?? hit.session_id,
		message_snippet: hit.snippet,
	}));

	const messageSnippets = new Map<string, Snippet>();
	for (const row of messageRows) {
		if (messageSnippets.has(row.session_id)) continue;
		messageSnippets.set(row.session_id, parseHighlighted(row.message_snippet, sentinels));
	}

	const items: UnifiedSearchItem[] = [];
	const seen = new Set<string>();
	const baseItem = (sessionId: string, projectId: string, mtimeMs: number) => ({
		kind: "session" as const,
		id: sessionId,
		projectId,
		projectName: projectNames.get(projectId) ?? projectId,
		mtime: new Date(mtimeMs).toISOString(),
	});

	for (const row of titleRows) {
		if (seen.has(row.session_id)) continue;
		seen.add(row.session_id);
		const title = parseHighlighted(row.title_highlight, sentinels);
		const snippet =
			usableSnippet(row.summary_snippet, title.text, sentinels) ??
			usableSnippet(row.prompt_snippet, title.text, sentinels) ??
			messageSnippets.get(row.session_id) ??
			null;
		const item: UnifiedSearchItem = {
			...baseItem(row.session_id, row.project_id, row.mtime_ms),
			title: title.text,
			titleMatches: title.matches,
		};
		if (snippet !== null) item.snippet = snippet;
		items.push(item);
	}

	for (const row of messageRows) {
		if (seen.has(row.session_id)) continue;
		seen.add(row.session_id);
		const snippet = messageSnippets.get(row.session_id);
		const item: UnifiedSearchItem = {
			...baseItem(row.session_id, row.project_id, row.mtime_ms),
			title: row.title,
			titleMatches: [],
		};
		if (snippet !== undefined) item.snippet = snippet;
		items.push(item);
	}

	return items;
}

function docHref(row: DocHitRow): string {
	const slug = toMdSlug(basename(row.path));
	return row.kind === "plan" ? `/plan/${slug}` : `/memory/${row.project_id}/${slug}`;
}

function searchDocs(
	db: IndexDb,
	ftsQuery: string,
	kinds: ReadonlyArray<DocHitRow["kind"]>,
	params: UnifiedSearchParams,
	cutoff: number | null,
	projectNames: Map<string, string>,
	sentinels: Sentinels,
): UnifiedSearchItem[] {
	const {open, close} = sentinels;
	const kindFilter = sql` AND d.kind IN (${sql.join(
		kinds.map((kind) => sql`${kind}`),
		sql`, `,
	)})`;
	const projectFilter = params.project === undefined ? sql`` : sql` AND d.project_id = ${params.project}`;
	const dateFilter = cutoff === null ? sql`` : sql` AND d.mtime_ms >= ${cutoff}`;

	const rows = db.all(
		sql`SELECT d.path, d.kind, d.project_id, d.mtime_ms,
				highlight(docs_fts, 2, ${open}, ${close}) AS title_highlight,
				snippet(docs_fts, 3, ${open}, ${close}, '...', ${SNIPPET_TOKENS}) AS content_snippet
			FROM docs_fts
			JOIN docs_content d ON d.id = docs_fts.rowid
			WHERE docs_fts MATCH ${ftsQuery}${kindFilter}${projectFilter}${dateFilter}
			ORDER BY bm25(docs_fts), d.mtime_ms DESC
			LIMIT ${params.limit}`,
	) as DocHitRow[];

	return rows.map((row) => {
		const title = parseHighlighted(row.title_highlight, sentinels);
		const item: UnifiedSearchItem = {
			kind: row.kind,
			id: row.path,
			title: title.text,
			titleMatches: title.matches,
			href: docHref(row),
			projectId: row.project_id,
			projectName: row.project_id === "" ? "" : (projectNames.get(row.project_id) ?? row.project_id),
			mtime: new Date(row.mtime_ms).toISOString(),
		};
		const snippet = parseHighlighted(row.content_snippet, sentinels);
		if (snippet.matches.length > 0) item.snippet = snippet;
		return item;
	});
}

function isWithin(path: string, root: string): boolean {
	return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function owningProject(path: string, projects: readonly ProjectRow[]): ProjectRow | null {
	let best: ProjectRow | null = null;
	for (const project of projects) {
		if (project.project_path === null || !isWithin(path, project.project_path)) continue;
		if (best === null || project.project_path.length > (best.project_path?.length ?? 0)) {
			best = project;
		}
	}
	return best;
}

function searchFiles(
	db: IndexDb,
	ftsQuery: string,
	terms: readonly string[],
	params: UnifiedSearchParams,
	cutoff: number | null,
	projects: readonly ProjectRow[],
	sentinels: Sentinels,
): UnifiedSearchItem[] {
	let scopeFilter = sql``;
	if (params.project !== undefined) {
		const root = projects.find((project) => project.id === params.project)?.project_path ?? null;
		if (root === null) return [];
		const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
		scopeFilter = sql` AND (file_content_fts.path = ${root}
				OR substr(file_content_fts.path, 1, ${prefix.length}) = ${prefix})`;
	}
	const dateFilter = cutoff === null ? sql`` : sql` AND COALESCE(indexed_files.mtime_ms, 0) >= ${cutoff}`;

	const rows = db.all(
		sql`SELECT file_content_fts.path AS path,
				snippet(file_content_fts, 1, ${sentinels.open}, ${sentinels.close}, '...', ${SNIPPET_TOKENS}) AS file_snippet,
				COALESCE(indexed_files.mtime_ms, 0) AS mtime_ms
			FROM file_content_fts
			LEFT JOIN indexed_files ON indexed_files.path = 'file-content:' || file_content_fts.path
			WHERE file_content_fts MATCH ${ftsQuery}${scopeFilter}${dateFilter}
			ORDER BY bm25(file_content_fts), mtime_ms DESC
			LIMIT ${params.limit}`,
	) as FileHitRow[];

	return rows.map((row) => {
		const project = owningProject(row.path, projects);
		const title = project?.project_path == null ? row.path : relative(project.project_path, row.path);
		const snippet = parseHighlighted(row.file_snippet, sentinels);
		return {
			kind: "file",
			id: row.path,
			title,
			titleMatches: substringMatches(title, terms),
			snippet,
			projectId: project?.id ?? "",
			projectName: project?.name ?? "",
			mtime: new Date(row.mtime_ms).toISOString(),
		};
	});
}

/**
 * Unified search over sessions (title FTS merged with transcript FTS, one item
 * per session with title hits first), plans and memories (`docs_fts`), and
 * indexed files.
 */
export function searchUnifiedDb(db: IndexDb, params: UnifiedSearchParams, now: number): UnifiedSearchItem[] {
	const terms = tokenizeFileSearchQuery(params.query);
	if (terms.length === 0) return [];

	const ftsQuery = toFtsQuery(terms);
	const cutoff = dateCutoff(params.date, now);
	const identifier = randomUUID();
	const sentinels: Sentinels = {
		open: `${identifier}-open`,
		close: `${identifier}-close`,
	};
	const projects = db.all(sql`SELECT id, name, project_path FROM projects`) as ProjectRow[];
	const projectNames = new Map(projects.map((project) => [project.id, project.name]));

	const items: UnifiedSearchItem[] = [];
	if (params.type === "all" || params.type === "sessions") {
		items.push(...searchSessions(db, ftsQuery, terms, params, cutoff, projectNames, sentinels));
	}
	const docKinds: Array<DocHitRow["kind"]> = [];
	if (params.type === "all" || params.type === "plans") docKinds.push("plan");
	if (params.type === "all" || params.type === "memories") docKinds.push("memory");
	if (docKinds.length > 0) {
		items.push(...searchDocs(db, ftsQuery, docKinds, params, cutoff, projectNames, sentinels));
	}
	if (params.type === "all" || params.type === "files") {
		items.push(...searchFiles(db, ftsQuery, terms, params, cutoff, projects, sentinels));
	}
	return items.slice(0, params.limit);
}
