import {lstat, readdir, readFile, realpath, stat} from "node:fs/promises";
import {createReadStream, realpathSync, type Stats} from "node:fs";
import {join, basename, extname, isAbsolute, relative, resolve, sep} from "node:path";
import {createLineReader} from "../line-reader";
import {eq, ne, notInArray, sql} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {
	SessionsIndexSchema,
	FileHistorySnapshotSchema,
	AttachmentRecordSchema,
	PrLinkRecordSchema,
	ForkedFromSchema,
	TaskFileSchema,
} from "../schemas";
import {encodeProjectPath, resolveProjectPath} from "../memory";
import {isCountableMessageRecord} from "../message-count";
import {deriveProjectDisplayName, lastEncodedSegment} from "../project-display-name";
import {normalizeGitBranch} from "../git-branch";
import {SYNTHETIC_MODEL} from "../model-name";
import {FirstUserMessageCollector, resolveFirstPrompt, resolveSessionTitle, TitleRecordCollector} from "../sessions";
import {currentJsonlState, foldJsonl, IncrementalJsonlCache} from "../incremental-jsonl";
import {extractTitleFromContent} from "../markdown-utils.server";
import {listTrackedFiles} from "../git-tracked";
import {trackActivity} from "../perf/event-loop-stalls";
import {retryWhileBusy} from "./busy";
import * as schema from "./schema";
import {ArtifactEventCollector, deleteArtifactEventsForSessions, replaceArtifactEvents} from "./artifact-index";
import {SlowCommandCollector} from "../slow-commands";
import {deleteRoutinesForSessions, replaceRoutines} from "./routine-index";
import {RoutineCollector} from "../routines";
import {UsageCollector} from "../home-stats";
import {unwrapPastedContent} from "../session-utils";
import {deleteUsageDailyForSessions, replaceUsageDaily} from "./usage-index";
import {
	BridgeSessionCollector,
	backfillSessionBridgeAliases,
	deleteSessionBridgeAliases,
	replaceSessionBridgeAliases,
	sessionBridgeMetadataKey,
} from "./bridge-session-index";
import {defined} from "../defined";
import {nonEmpty} from "../non-empty";
import {asRecord, isRecord} from "../narrow";

type IndexDb = BetterSQLite3Database<typeof schema>;

const PLAN_PATH_RE = /\.claude\/plans\/([^/]+\.md)$/;
/** System records the CLI writes once a turn has ended. */
const TURN_END_SUBTYPES: ReadonlySet<unknown> = new Set(["turn_duration", "stop_hook_summary", "away_summary"]);
const FILE_CONTENT_CACHE_PREFIX = "file-content:";
const FILE_CONTENT_CLEANUP_BATCH_SIZE = 100;
// Four bound values per row keep each insert below SQLite's historical 999-variable limit.
const SESSION_MESSAGE_INSERT_BATCH_SIZE = 200;
export const FILE_CONTENT_SIZE_CAP_BYTES = 5 * 1024 * 1024;
const resolvedProjectsDirectories = new Map<string, string>();

interface NormalizedProjectFile {
	project: string;
	relativeParts: string[];
}

const NON_SEARCHABLE_FILE_EXTENSIONS = new Set([
	".7z",
	".a",
	".avi",
	".avif",
	".bin",
	".bmp",
	".bz2",
	".class",
	".db",
	".dll",
	".dmg",
	".doc",
	".docx",
	".eot",
	".exe",
	".flac",
	".gif",
	".gz",
	".ico",
	".icns",
	".jar",
	".jpeg",
	".jpg",
	".m4a",
	".map",
	".mkv",
	".mov",
	".mp3",
	".mp4",
	".o",
	".ogg",
	".otf",
	".pdf",
	".png",
	".rar",
	".so",
	".sqlite",
	".sqlite3",
	".tar",
	".tiff",
	".ttf",
	".wav",
	".webm",
	".webp",
	".woff",
	".woff2",
	".xls",
	".xlsx",
	".xz",
	".zip",
]);

/** Reject known binary files and generated source maps before opening them. */
export function isFileContentIndexable(filePath: string): boolean {
	return !NON_SEARCHABLE_FILE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function persistProject(db: IndexDb, project: string, projectPath: string | null, updatedAt: number): void {
	const existingProject = db
		.select({name: schema.projects.name})
		.from(schema.projects)
		.where(eq(schema.projects.id, project))
		.get();
	const knownProjects = db
		.select({
			id: schema.projects.id,
			name: schema.projects.name,
			projectPath: schema.projects.projectPath,
		})
		.from(schema.projects)
		.where(ne(schema.projects.id, project))
		.all();
	const derivedName = deriveProjectDisplayName(project, projectPath, knownProjects);
	// Without a path the derivation is lossy, so keep an existing name that
	// carries more information than the encoded id (e.g. one resolved from a
	// since-deleted directory). Names we derived ourselves ("/" separators or
	// the legacy final token) are always safe to recompute.
	const projectName =
		projectPath ||
		!existingProject ||
		existingProject.name === lastEncodedSegment(project) ||
		existingProject.name.includes("/")
			? derivedName
			: existingProject.name;

	db.insert(schema.projects)
		.values({
			id: project,
			name: projectName,
			projectPath,
			updatedAt,
		})
		.onConflictDoUpdate({
			target: schema.projects.id,
			set: {name: projectName, projectPath, updatedAt},
		})
		.run();
}

function repairProjectDisplayNames(db: IndexDb): void {
	const projects = db
		.select({
			id: schema.projects.id,
			projectPath: schema.projects.projectPath,
			updatedAt: schema.projects.updatedAt,
		})
		.from(schema.projects)
		.all();

	// Shortest ids first, so a parent project's name is repaired before the
	// worktrees and nested checkouts that derive their names from it.
	projects.sort((a, b) => a.id.length - b.id.length);
	for (const project of projects) {
		persistProject(db, project.id, project.projectPath, project.updatedAt);
	}
}

function fileContentCachePath(filePath: string): string {
	// `indexed_files.path` is also consumed by transcript, plan, task, and
	// memory indexers. A namespaced key gives file content its own exact
	// ownership without letting one consumer short-circuit or delete another.
	return `${FILE_CONTENT_CACHE_PREFIX}${filePath}`;
}

export function isPathInsideFileContentRoots(filePath: string, roots: readonly string[]): boolean {
	const normalizedPath = resolve(filePath);
	return roots.some((root) => {
		const relativePath = relative(root, normalizedPath);
		return (
			relativePath === "" ||
			(relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
		);
	});
}

/** Resolve and cache the canonical projects root for the lifetime of the process. */
export function resolveProjectsDirectory(projectsDir: string): string {
	const unresolvedProjectsDir = resolve(projectsDir);
	const cachedProjectsDir = resolvedProjectsDirectories.get(unresolvedProjectsDir);
	if (cachedProjectsDir) return cachedProjectsDir;

	const resolvedProjectsDir = realpathSync(unresolvedProjectsDir);
	resolvedProjectsDirectories.set(unresolvedProjectsDir, resolvedProjectsDir);
	return resolvedProjectsDir;
}

function normalizeProjectFile(filePath: string, projectsDir: string): NormalizedProjectFile | null {
	const unresolvedProjectsDir = resolve(projectsDir);
	const resolvedProjectsDir = resolveProjectsDirectory(unresolvedProjectsDir);
	const unresolvedFilePath = resolve(filePath);
	if (!isPathInsideFileContentRoots(unresolvedFilePath, [unresolvedProjectsDir, resolvedProjectsDir])) {
		return null;
	}

	const resolvedFilePath = realpathSync(unresolvedFilePath);
	if (!isPathInsideFileContentRoots(resolvedFilePath, [resolvedProjectsDir])) return null;

	const relativeParts = relative(resolvedProjectsDir, resolvedFilePath).split(sep);
	const project = relativeParts[0];
	if (!project || project === ".") return null;
	return {project, relativeParts};
}

function deleteFileContentRows(db: IndexDb, filePath: string): void {
	db.transaction((transaction) => {
		transaction.run(sql`DELETE FROM file_content WHERE path = ${filePath}`);
		transaction
			.delete(schema.indexedFiles)
			.where(eq(schema.indexedFiles.path, fileContentCachePath(filePath)))
			.run();
	});
}

/** Remove content-search data owned by one exact filesystem path. */
export function deleteFileContent(db: IndexDb, filePath: string): void {
	deleteFileContentRows(db, resolve(filePath));
}

/** Index one regular text file after enforcing containment in configured roots. */
export async function indexFileContent(
	db: IndexDb,
	filePath: string,
	roots: readonly string[],
): Promise<{changed: boolean}> {
	const normalizedPath = resolve(filePath);
	if (!isPathInsideFileContentRoots(normalizedPath, roots)) return {changed: false};
	if (!isFileContentIndexable(normalizedPath)) return {changed: false};

	let resolvedPath: string;
	let fileStat: Awaited<ReturnType<typeof stat>>;
	try {
		// Do not follow symlinked entries. A link under an allowed root could
		// otherwise make the content index read a target outside that root.
		if (!(await lstat(normalizedPath)).isFile()) return {changed: false};
		resolvedPath = await realpath(normalizedPath);
		if (!isPathInsideFileContentRoots(resolvedPath, roots)) return {changed: false};
		fileStat = await stat(resolvedPath);
	} catch {
		return {changed: false};
	}

	const cachePath = fileContentCachePath(resolvedPath);
	const existing = db.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, cachePath)).get();
	if (existing && existing.mtimeMs === fileStat.mtimeMs && existing.sizeBytes === fileStat.size) {
		return {changed: false};
	}

	if (fileStat.size > FILE_CONTENT_SIZE_CAP_BYTES) {
		deleteFileContentRows(db, resolvedPath);
		return {changed: true};
	}

	let contents: Buffer;
	try {
		contents = await readFile(resolvedPath);
	} catch {
		return {changed: false};
	}
	if (contents.byteLength > FILE_CONTENT_SIZE_CAP_BYTES || contents.subarray(0, 512).includes(0)) {
		deleteFileContentRows(db, resolvedPath);
		return {changed: true};
	}

	const indexedAt = Date.now();
	db.transaction((transaction) => {
		transaction.run(sql`DELETE FROM file_content WHERE path = ${resolvedPath}`);
		transaction.run(
			sql`INSERT INTO file_content(path, content) VALUES (${resolvedPath}, ${contents.toString("utf8")})`,
		);
		transaction
			.insert(schema.indexedFiles)
			.values({
				path: cachePath,
				mtimeMs: fileStat.mtimeMs,
				sizeBytes: fileStat.size,
				indexedAt,
			})
			.onConflictDoUpdate({
				target: schema.indexedFiles.path,
				set: {
					mtimeMs: fileStat.mtimeMs,
					sizeBytes: fileStat.size,
					indexedAt,
				},
			})
			.run();
	});

	return {changed: true};
}

function pathContainsIgnoredDirectory(path: string, ignoredDirNames: ReadonlySet<string>): boolean {
	return path.split(sep).some((segment) => ignoredDirNames.has(segment));
}

/** Discover configured roots once at startup and reconcile their FTS rows. */
export async function scanFileContentRoots(
	db: IndexDb,
	roots: readonly string[],
	ignoredDirNames: ReadonlySet<string>,
	signal?: AbortSignal,
): Promise<void> {
	const discoveredPaths = new Set<string>();
	let scanComplete = true;
	const cachedFiles = db.all<{path: string; mtime_ms: number; size_bytes: number}>(
		sql`SELECT path, mtime_ms, size_bytes FROM indexed_files WHERE path LIKE ${`${FILE_CONTENT_CACHE_PREFIX}%`}`,
	);
	const cachedMetadataByPath = new Map(
		cachedFiles.map((file) => [
			file.path.slice(FILE_CONTENT_CACHE_PREFIX.length),
			{mtimeMs: file.mtime_ms, sizeBytes: file.size_bytes},
		]),
	);

	for (const root of roots) {
		if (pathContainsIgnoredDirectory(root, ignoredDirNames)) continue;

		let trackedPaths: string[];
		try {
			trackedPaths = await listTrackedFiles(root);
		} catch {
			scanComplete = false;
			continue;
		}

		for (const trackedPath of trackedPaths) {
			signal?.throwIfAborted();
			if (
				pathContainsIgnoredDirectory(relative(root, trackedPath), ignoredDirNames) ||
				!isFileContentIndexable(trackedPath)
			) {
				continue;
			}

			const resolvedPath = resolve(trackedPath);
			try {
				const fileStat = await stat(trackedPath);
				discoveredPaths.add(resolvedPath);
				const cachedMetadata = cachedMetadataByPath.get(resolvedPath);
				if (cachedMetadata?.mtimeMs === fileStat.mtimeMs && cachedMetadata.sizeBytes === fileStat.size) {
					continue;
				}
			} catch {
				continue;
			}
			await trackActivity(`file-content scan ${trackedPath}`, async () =>
				retryWhileBusy(async () => indexFileContent(db, trackedPath, roots), signal),
			);
		}
	}

	const indexedPaths = db.all<{path: string}>(sql`SELECT path FROM file_content`);
	const stalePaths = indexedPaths
		.map((indexedPath) => indexedPath.path)
		.filter(
			(indexedPath) =>
				!isPathInsideFileContentRoots(indexedPath, roots) ||
				(scanComplete && !discoveredPaths.has(indexedPath)),
		);
	for (let offset = 0; offset < stalePaths.length; offset += FILE_CONTENT_CLEANUP_BATCH_SIZE) {
		signal?.throwIfAborted();
		const batch = stalePaths.slice(offset, offset + FILE_CONTENT_CLEANUP_BATCH_SIZE);
		await retryWhileBusy(() => {
			db.transaction((transaction) => {
				for (const stalePath of batch) {
					transaction.run(sql`DELETE FROM file_content WHERE path = ${stalePath}`);
					transaction
						.delete(schema.indexedFiles)
						.where(eq(schema.indexedFiles.path, fileContentCachePath(stalePath)))
						.run();
				}
			});
		}, signal);
		await new Promise<void>((resolveYield) => {
			setImmediate(resolveYield);
		});
	}
}

export async function indexSessionsIndex(db: IndexDb, projectDir: string, project: string): Promise<void> {
	const indexPath = join(projectDir, "sessions-index.json");
	let fileStat: Awaited<ReturnType<typeof stat>>;
	try {
		fileStat = await stat(indexPath);
	} catch {
		return;
	}

	const existing = db.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, indexPath)).get();
	if (existing && existing.mtimeMs === fileStat.mtimeMs) return;

	let raw: string;
	try {
		raw = await readFile(indexPath, "utf-8");
	} catch {
		return;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return;
	}

	const result = SessionsIndexSchema.safeParse(parsed);
	if (!result.success) return;

	const firstEntry = result.data.entries[0];
	const projectPath = firstEntry?.projectPath ?? null;

	persistProject(db, project, projectPath, fileStat.mtimeMs);

	// Upsert sessions
	for (const entry of result.data.entries) {
		const fp = await resolveFirstPrompt(entry.firstPrompt, entry.fullPath);
		const summ = entry.summary;
		const branch = normalizeGitBranch(entry.gitBranch);
		const entryProjectPath = entry.projectPath;
		const sidechain = entry.isSidechain;
		// Transcript-derived titles (custom, then ai) outrank anything
		// sessions-index.json knows; the coalesce below keeps them on rewrite.
		const title = resolveSessionTitle({
			summary: summ,
			firstPrompt: fp ?? undefined,
			sessionId: entry.sessionId,
		});
		const createdAt = entry.created ? new Date(entry.created).getTime() : entry.fileMtime;

		db.insert(schema.sessions)
			.values({
				id: entry.sessionId,
				projectId: project,
				title,
				firstPrompt: fp?.text ?? null,
				summary: summ ?? null,
				customTitle: null,
				aiTitle: null,
				// sessions-index.json counts messages with Claude Code's own
				// definition, which disagrees with ours (see message-count.ts).
				// indexJsonlFile owns message_count; a fresh row starts at 0 until
				// the transcript itself is indexed.
				messageCount: 0,
				gitBranch: branch,
				cwd: entryProjectPath ?? null,
				isSidechain: sidechain ? 1 : 0,
				createdAt,
				mtimeMs: entry.fileMtime,
				filePath: entry.fullPath,
			})
			.onConflictDoUpdate({
				target: schema.sessions.id,
				set: {
					title: sql<string>`coalesce(${schema.sessions.customTitle}, ${schema.sessions.aiTitle}, ${title})`,
					firstPrompt: fp?.text ?? null,
					summary: summ ?? null,
					gitBranch: branch,
					cwd: entryProjectPath ?? null,
					isSidechain: sidechain ? 1 : 0,
					// indexJsonlFile owns mtime_ms once the row exists, dating it by the transcript's last record.
				},
			})
			.run();
	}

	// Update indexed_files
	db.insert(schema.indexedFiles)
		.values({
			path: indexPath,
			mtimeMs: fileStat.mtimeMs,
			sizeBytes: fileStat.size,
			indexedAt: Date.now(),
		})
		.onConflictDoUpdate({
			target: schema.indexedFiles.path,
			set: {
				mtimeMs: fileStat.mtimeMs,
				sizeBytes: fileStat.size,
				indexedAt: Date.now(),
			},
		})
		.run();
}

/** Agent → subagent links found in a transcript, applied to the subagents table by applySubagentLinks. */
interface SubagentLink {
	agentId: string;
	description: string | null;
}

/** Pairs each Agent tool_use with the tool_result that names the subagent it started. */
class SubagentLinkCollector {
	private readonly toolCallDescriptions = new Map<string, string>();
	readonly links: SubagentLink[] = [];

	add(record: unknown): void {
		const content = asRecord(asRecord(record)?.["message"])?.["content"];
		if (!Array.isArray(content)) return;

		for (const block of content) {
			if (!isRecord(block)) continue;
			const id = stringField(block, "id");
			const toolUseId = stringField(block, "tool_use_id");

			// Track Agent tool_use calls by their id + description
			if (block["type"] === "tool_use" && block["name"] === "Agent" && id) {
				this.toolCallDescriptions.set(id, stringField(block["input"], "description") ?? "");
			}

			// Extract agentId from tool_result
			if (block["type"] === "tool_result" && toolUseId && this.toolCallDescriptions.has(toolUseId)) {
				let resultText = "";
				const resultContent = block["content"];
				if (typeof resultContent === "string") {
					resultText = resultContent;
				} else if (Array.isArray(resultContent)) {
					resultText = resultContent
						.flatMap((b: unknown) =>
							isRecord(b) && b["type"] === "text" ? (stringField(b, "text") ?? []) : [],
						)
						.join(" ");
				}
				const match = AGENT_ID_RE.exec(resultText);
				if (match?.[1]) {
					this.links.push({
						agentId: `agent-${match[1]}`,
						description: nonEmpty(this.toolCallDescriptions.get(toolUseId)) ?? null,
					});
				}
			}
		}
	}
}

function applySubagentLinks(db: IndexDb, links: readonly SubagentLink[], parentAgentId: string | null): void {
	for (const {agentId, description} of links) {
		// COALESCE keeps existing parentAgentId so the root-session
		// pass doesn't overwrite nested parent links.
		db.run(
			sql`UPDATE subagents SET parent_agent_id = COALESCE(parent_agent_id, ${parentAgentId}), description = COALESCE(${description}, description) WHERE id = ${agentId}`,
		);
	}
}

interface IndexedMessage {
	sessionId: string;
	messageIndex: number;
	role: "user" | "assistant";
	text: string | null;
}

/** Everything indexJsonlFile derives from a session transcript, folded one line at a time. */
class SessionIndexState {
	readonly bridgeSessions = new BridgeSessionCollector();
	readonly planFilenames = new Set<string>();
	readonly titleRecords = new TitleRecordCollector();
	latestPrLink: {prNumber: number; prUrl: string; prRepository: string} | null = null;
	forkedFromSessionId: string | null = null;
	lastSessionCwd: string | undefined;
	anchoredSessionCwd: string | undefined;
	sessionGitBranch: string | null = null;
	/** The newest record `timestamp`: the CLI touches a waiting session's file without appending, so mtime overstates activity. */
	lastRecordAt: number | null = null;
	/** The newest record that ends a turn: turn_duration, a stop-hook summary or an away summary. */
	lastTurnEndAt: number | null = null;
	/** Task ids (or teammate names) each pending TaskStop or KillShell call targets, by tool_use id. */
	readonly pendingStops = new Map<string, string>();
	/** Task ids and teammate names a successful TaskStop or KillShell stopped. */
	readonly stoppedTaskIds = new Set<string>();
	readonly mcpToolNames = new Set<string>();
	readonly artifactEvents = new ArtifactEventCollector();
	readonly routines = new RoutineCollector();
	readonly usage = new UsageCollector();
	readonly firstPrompt = new FirstUserMessageCollector();
	readonly subagentLinks = new SubagentLinkCollector();
	readonly indexedMessages: IndexedMessage[] = [];
	messageCount = 0;
	/** How many of `indexedMessages` the last persist left in session_messages. */
	persistedMessages = 0;
	/** How many message_content rows the last persist left for this session. */
	persistedContentRows = 0;

	constructor(
		readonly sessionId: string,
		readonly project: string,
	) {}

	/** Track TaskStop and KillShell calls, keeping the targets of the ones that succeeded. */
	private collectStops(obj: Record<string, unknown>): void {
		const content = asRecord(obj["message"])?.["content"];
		if (!Array.isArray(content)) return;
		for (const block of content) {
			if (!isRecord(block)) continue;
			if (block["type"] === "tool_use" && (block["name"] === "TaskStop" || block["name"] === "KillShell")) {
				const input = asRecord(block["input"]);
				const target = stringField(input, "task_id") ?? stringField(input, "shell_id");
				const id = stringField(block, "id");
				if (target !== null && id !== null) this.pendingStops.set(id, target);
			} else if (block["type"] === "tool_result") {
				const id = stringField(block, "tool_use_id");
				const target = id === null ? undefined : this.pendingStops.get(id);
				if (id === null || target === undefined) continue;
				this.pendingStops.delete(id);
				if (block["is_error"] !== true) this.stoppedTaskIds.add(target);
			}
		}
	}

	add(line: string): void {
		this.firstPrompt.add(line);

		if (line.includes("file-history-snapshot")) {
			try {
				const parsed: unknown = JSON.parse(line);
				const result = FileHistorySnapshotSchema.safeParse(parsed);
				if (result.success) {
					for (const key of Object.keys(result.data.snapshot.trackedFileBackups)) {
						const match = PLAN_PATH_RE.exec(key);
						if (match?.[1]) this.planFilenames.add(match[1]);
					}
				}
			} catch {
				// skip
			}
		}

		// plan_mode attachments link a session to its plan file even before
		// the plan is edited (file-history-snapshot only fires after edits).
		if (line.includes('"plan_mode"')) {
			try {
				const parsed: unknown = JSON.parse(line);
				const result = AttachmentRecordSchema.safeParse(parsed);
				if (result.success && result.data.attachment.type === "plan_mode") {
					const planPath = result.data.attachment.planFilePath;
					if (planPath) {
						const match = PLAN_PATH_RE.exec(planPath);
						if (match?.[1]) this.planFilenames.add(match[1]);
					}
				}
			} catch {
				// skip
			}
		}

		if (line.includes('"cwd"')) {
			try {
				const cwd = stringField(JSON.parse(line), "cwd");
				if (cwd !== null) {
					this.lastSessionCwd = cwd;
					if (encodeProjectPath(cwd) === this.project) {
						this.anchoredSessionCwd = cwd;
					}
				}
			} catch {
				// skip
			}
		}

		// Extract gitBranch from early lines. Detached-HEAD lines normalize to
		// null, so keep scanning until a real branch name appears (if any).
		if (!this.sessionGitBranch && line.includes('"gitBranch"')) {
			try {
				const gitBranch = stringField(JSON.parse(line), "gitBranch");
				if (gitBranch !== null) {
					this.sessionGitBranch = normalizeGitBranch(gitBranch);
				}
			} catch {
				// skip
			}
		}

		// Latest wins: a session that opened a second PR links to the newer one.
		if (line.includes('"pr-link"')) {
			try {
				const result = PrLinkRecordSchema.safeParse(JSON.parse(line));
				if (result.success) this.latestPrLink = result.data;
			} catch {
				// skip
			}
		}

		// First wins: every record of a branched session carries the same lineage.
		if (this.forkedFromSessionId === null && line.includes('"forkedFrom"')) {
			try {
				const result = ForkedFromSchema.safeParse(asRecord(JSON.parse(line))?.["forkedFrom"]);
				if (result.success) {
					this.forkedFromSessionId = typeof result.data === "string" ? result.data : result.data.sessionId;
				}
			} catch {
				// skip
			}
		}

		if (line.includes('"custom-title"') || line.includes('"ai-title"')) {
			try {
				this.titleRecords.add(JSON.parse(line));
			} catch {
				// skip
			}
		}

		let obj: unknown;
		try {
			obj = JSON.parse(line);
		} catch {
			return; // skip malformed lines
		}
		if (!isRecord(obj)) return;
		const type = obj["type"];
		if (type === "bridge-session") this.bridgeSessions.add(obj, this.sessionId);
		const timestamp = obj["timestamp"];
		if (typeof timestamp === "string") {
			const recordAt = Date.parse(timestamp);
			if (recordAt > (this.lastRecordAt ?? -Infinity)) this.lastRecordAt = recordAt;
			if (
				type === "system" &&
				TURN_END_SUBTYPES.has(obj["subtype"]) &&
				recordAt > (this.lastTurnEndAt ?? -Infinity)
			) {
				this.lastTurnEndAt = recordAt;
			}
		}

		try {
			this.subagentLinks.add(obj);
		} catch {
			// malformed content blocks
		}
		this.collectStops(obj);

		// Extract text content for FTS indexing
		try {
			if (isCountableMessageRecord(obj)) this.messageCount++;
			this.artifactEvents.add(obj);
			this.routines.add(obj);
			this.usage.add(obj);
			if (type === "user" || type === "assistant") {
				const content = asRecord(obj["message"])?.["content"];
				const messageText: string[] = [];
				const userText = (text: string) => (type === "user" ? unwrapPastedContent(text) : text);
				if (typeof content === "string") {
					messageText.push(userText(content));
				} else if (Array.isArray(content)) {
					for (const block of content) {
						if (!isRecord(block)) continue;
						const text = stringField(block, "text");
						const name = stringField(block, "name");
						if (block["type"] === "text" && text !== null) {
							messageText.push(userText(text));
						} else if (block["type"] === "tool_use" && name?.startsWith("mcp__")) {
							this.mcpToolNames.add(name);
						}
					}
				}
				const substantiveText = messageText.join("\n").trim();
				this.indexedMessages.push({
					sessionId: this.sessionId,
					messageIndex: this.indexedMessages.length,
					role: type,
					text: substantiveText === "" ? null : substantiveText,
				});
			}
		} catch {
			// skip malformed lines
		}
	}
}

/** Per-file parse state the watcher keeps for live transcripts, so an append re-reads only the new lines. */
export type JsonlIndexCache = IncrementalJsonlCache<SessionIndexState>;

/** Each entry holds a whole transcript's parse state; a handful covers the sessions being written right now. */
const JSONL_INDEX_CACHE_ENTRIES = 8;

export function createJsonlIndexCache(): JsonlIndexCache {
	return new IncrementalJsonlCache(JSONL_INDEX_CACHE_ENTRIES);
}

/** The cache the watcher and the hook dispatcher share for the transcripts being written right now. */
export const liveJsonlIndexCache = createJsonlIndexCache();

export interface IndexJsonlOptions {
	/** Resume from, and keep, the file's parse state here instead of reading the whole transcript. */
	cache?: JsonlIndexCache;
}

export async function indexJsonlFile(
	db: IndexDb,
	filePath: string,
	project: string,
	options: IndexJsonlOptions = {},
): Promise<{linkedPlans: string[]}> {
	const {linkedPlans} = await indexJsonlFileWithLinks(db, filePath, project, options);
	return {linkedPlans};
}

/** indexJsonlFile, plus the subagent links of the transcript when they are known without another read. */
async function indexJsonlFileWithLinks(
	db: IndexDb,
	filePath: string,
	project: string,
	{cache}: IndexJsonlOptions,
): Promise<{linkedPlans: string[]; subagentLinks?: readonly SubagentLink[]}> {
	let fileStat: Stats;
	try {
		fileStat = await stat(filePath);
	} catch {
		return {linkedPlans: []};
	}

	const sessionId = basename(filePath, ".jsonl");
	const existing = db.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).get();
	if (existing && existing.mtimeMs === fileStat.mtimeMs) {
		// Only trust the mtime skip when the session row actually exists; a
		// stale indexed_files row must not leave a re-inserted session at
		// messageCount 0 forever.
		const sessionRow = db
			.select({
				id: schema.sessions.id,
				filePath: schema.sessions.filePath,
				bridgeMetadataKey: schema.metadata.key,
			})
			.from(schema.sessions)
			.leftJoin(schema.metadata, eq(schema.metadata.key, sessionBridgeMetadataKey(sessionId)))
			.where(eq(schema.sessions.id, sessionId))
			.get();
		if (sessionRow) {
			if (sessionRow.filePath === filePath && sessionRow.bridgeMetadataKey === null) {
				await backfillSessionBridgeAliases(db, filePath, sessionId);
			}
			const current =
				cache === undefined ? undefined : await currentJsonlState(cache, filePath).catch(() => undefined);
			return current?.project === project
				? {linkedPlans: [], subagentLinks: current.subagentLinks.links}
				: {linkedPlans: []};
		}
	}

	const parseAndPersist = async () => {
		if (cache !== undefined && cache.get(filePath)?.state.project !== project) cache.delete(filePath);
		const state = await foldJsonl(
			filePath,
			{
				create: () => new SessionIndexState(sessionId, project),
				add: (folded, line) => {
					folded.add(line);
				},
			},
			cache,
		);
		await persistSessionIndexState(db, filePath, project, fileStat, state);
		return {linkedPlans: Array.from(state.planFilenames), subagentLinks: state.subagentLinks.links};
	};
	return cache === undefined ? parseAndPersist() : cache.exclusive(filePath, parseAndPersist);
}

async function persistSessionIndexState(
	db: IndexDb,
	filePath: string,
	project: string,
	fileStat: Stats,
	state: SessionIndexState,
): Promise<void> {
	const {sessionId} = state;
	const {customTitle, aiTitle} = await state.titleRecords.finish(filePath);
	const sessionCwd = state.anchoredSessionCwd ?? state.lastSessionCwd;
	const {latestPrLink, forkedFromSessionId, sessionGitBranch, messageCount} = state;
	// sessions.mtime_ms is the activity time every list sorts and stamps by.
	const activityAt = state.lastRecordAt ?? fileStat.mtimeMs;

	// Upsert plan links
	for (const planFilename of state.planFilenames) {
		db.insert(schema.planSessions)
			.values({planFilename, sessionId, projectId: project})
			.onConflictDoNothing()
			.run();
	}

	const existingSession = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
	const firstPrompt = state.firstPrompt.result();
	// The directory encoding is lossy (dots become dashes), so a recorded cwd that
	// encodes to this project is the exact path; probing the filesystem is a fallback.
	const projectPath = state.anchoredSessionCwd ?? (await resolveProjectPath(project));

	persistProject(db, project, projectPath, fileStat.mtimeMs);
	if (existingSession) {
		const updates: Record<string, unknown> = {
			mtimeMs: activityAt,
			messageCount,
			turnEndedAt: state.lastTurnEndAt,
			stoppedTaskIdsJson: JSON.stringify([...state.stoppedTaskIds]),
		};
		updates["filePath"] = filePath;
		updates["projectId"] = project;
		updates["firstPrompt"] = firstPrompt?.text ?? null;
		updates["customTitle"] = customTitle ?? null;
		updates["aiTitle"] = aiTitle ?? null;
		updates["prNumber"] = latestPrLink?.prNumber ?? null;
		updates["prUrl"] = latestPrLink?.prUrl ?? null;
		updates["prRepository"] = latestPrLink?.prRepository ?? null;
		updates["forkedFromSessionId"] = forkedFromSessionId;
		updates["title"] = resolveSessionTitle({
			customTitle,
			aiTitle,
			summary: existingSession.summary ?? undefined,
			firstPrompt: firstPrompt ?? undefined,
			sessionId,
		});
		if (sessionCwd) {
			updates["cwd"] = sessionCwd;
		}
		if (sessionGitBranch) {
			updates["gitBranch"] = sessionGitBranch;
		}
		db.update(schema.sessions).set(updates).where(eq(schema.sessions.id, sessionId)).run();
	} else {
		const title = resolveSessionTitle({
			customTitle,
			aiTitle,
			firstPrompt: firstPrompt ?? undefined,
			sessionId,
		});

		db.insert(schema.sessions)
			.values({
				id: sessionId,
				projectId: project,
				title,
				firstPrompt: firstPrompt?.text ?? null,
				summary: null,
				customTitle: customTitle ?? null,
				aiTitle: aiTitle ?? null,
				prNumber: latestPrLink?.prNumber ?? null,
				prUrl: latestPrLink?.prUrl ?? null,
				prRepository: latestPrLink?.prRepository ?? null,
				forkedFromSessionId,
				messageCount,
				gitBranch: sessionGitBranch,
				cwd: sessionCwd ?? null,
				isSidechain: 0,
				createdAt: fileStat.birthtimeMs,
				mtimeMs: activityAt,
				filePath,
				turnEndedAt: state.lastTurnEndAt,
				stoppedTaskIdsJson: JSON.stringify([...state.stoppedTaskIds]),
			})
			.run();
	}

	// Replace structured message rows and their per-message search rows. Role and order are retained here so
	// consumers never need to tail the JSONL to recover the latest substantive assistant response.
	// A resumed state appends the rows after the ones it already wrote, as long as nothing else replaced them, so a
	// live append tokenizes only the new messages.
	const {indexedMessages, persistedMessages} = state;
	let contentRows = 0;
	db.transaction((transaction) => {
		const persisted =
			persistedMessages > 0
				? transaction.get<{messages: number; content: number}>(
						sql`SELECT
							(SELECT count(*) FROM session_messages WHERE session_id = ${sessionId}) AS messages,
							(SELECT count(*) FROM message_content WHERE session_id = ${sessionId}) AS content`,
					)
				: undefined;
		const resumed = persisted?.messages === persistedMessages && persisted.content === state.persistedContentRows;
		if (!resumed) {
			transaction.delete(schema.sessionMessages).where(eq(schema.sessionMessages.sessionId, sessionId)).run();
			transaction.run(sql`DELETE FROM message_content WHERE session_id = ${sessionId}`);
		}
		const firstNew = resumed ? persistedMessages : 0;
		for (let offset = firstNew; offset < indexedMessages.length; offset += SESSION_MESSAGE_INSERT_BATCH_SIZE) {
			transaction
				.insert(schema.sessionMessages)
				.values(indexedMessages.slice(offset, offset + SESSION_MESSAGE_INSERT_BATCH_SIZE))
				.run();
		}
		const inserted =
			firstNew < indexedMessages.length
				? transaction.run(
						sql`INSERT INTO message_content(session_id, message_index, content)
							SELECT session_id, message_index, text FROM session_messages
							WHERE session_id = ${sessionId} AND message_index >= ${firstNew} AND text IS NOT NULL
							ORDER BY message_index`,
					).changes
				: 0;
		contentRows = (resumed ? state.persistedContentRows : 0) + inserted;
	});
	state.persistedMessages = indexedMessages.length;
	state.persistedContentRows = contentRows;

	db.transaction((transaction) => {
		transaction.delete(schema.sessionMcpTools).where(eq(schema.sessionMcpTools.sessionId, sessionId)).run();
		if (state.mcpToolNames.size > 0) {
			transaction
				.insert(schema.sessionMcpTools)
				.values(Array.from(state.mcpToolNames, (toolName) => ({sessionId, toolName})))
				.run();
		}
	});

	replaceArtifactEvents(
		db,
		{filePath, sessionId, projectId: project, isSubagent: false},
		state.artifactEvents.events(),
	);
	replaceRoutines(db, {filePath, sessionId, projectId: project}, state.routines.routines());
	replaceUsageDaily(db, {filePath, sessionId}, state.usage.rows());
	replaceSessionBridgeAliases(db, sessionId, state.bridgeSessions);

	// Update indexed_files
	db.insert(schema.indexedFiles)
		.values({
			path: filePath,
			mtimeMs: fileStat.mtimeMs,
			sizeBytes: fileStat.size,
			indexedAt: Date.now(),
		})
		.onConflictDoUpdate({
			target: schema.indexedFiles.path,
			set: {
				mtimeMs: fileStat.mtimeMs,
				sizeBytes: fileStat.size,
				indexedAt: Date.now(),
			},
		})
		.run();
}

export async function indexSubagentFile(
	db: IndexDb,
	filePath: string,
	sessionId: string,
	project: string,
): Promise<void> {
	let fileStat: Awaited<ReturnType<typeof stat>>;
	try {
		fileStat = await stat(filePath);
	} catch {
		return;
	}

	const existing = db.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).get();
	if (existing && existing.mtimeMs === fileStat.mtimeMs) return;

	const agentFilename = basename(filePath, ".jsonl");
	const metaPath = filePath.replace(/\.jsonl$/, ".meta.json");
	let agentType: string | null = null;
	let metaDescription: string | null = null;
	let requestedModel: string | null = null;
	let taskKind: string | null = null;
	let teammateName: string | null = null;
	try {
		const meta: unknown = JSON.parse(await readFile(metaPath, "utf-8"));
		agentType = stringField(meta, "agentType");
		metaDescription = stringField(meta, "description");
		requestedModel = stringField(meta, "model");
		taskKind = stringField(meta, "taskKind");
		teammateName = stringField(meta, "name");
	} catch {
		// no meta file
	}

	let slug: string | null = null;
	let attributionAgent: string | null = null;
	let resolvedModel: string | null = null;
	let startedAt: string | null = null;
	let finishedAt: string | null = null;
	const artifactEvents = new ArtifactEventCollector();
	const slowCommands = new SlowCommandCollector();
	const rl = createLineReader(createReadStream(filePath, {encoding: "utf-8"}));
	try {
		for await (const line of rl) {
			if (!line.trim()) continue;
			try {
				const obj: unknown = JSON.parse(line);
				const recordAttributionAgent = stringField(obj, "attributionAgent");
				if (recordAttributionAgent && !attributionAgent) {
					attributionAgent = recordAttributionAgent;
				}
				const recordSlug = stringField(obj, "slug");
				if (recordSlug && !slug) slug = recordSlug;
				const recordModel = stringField(asRecord(obj)?.["message"], "model");
				if (recordModel && recordModel !== SYNTHETIC_MODEL && !resolvedModel) {
					resolvedModel = recordModel;
				}
				const timestamp = stringField(obj, "timestamp");
				if (timestamp) {
					startedAt ??= timestamp;
					finishedAt = timestamp;
				}
				artifactEvents.add(obj);
				slowCommands.add(obj);
			} catch {
				// skip
			}
		}
	} finally {
		await rl.close();
	}
	const slowCommandEndsJson = JSON.stringify(slowCommands.ends());

	db.insert(schema.subagents)
		.values({
			id: agentFilename,
			sessionId,
			projectId: project,
			agentType: agentType ?? attributionAgent,
			attributionAgent,
			slug,
			description: metaDescription,
			model: resolvedModel ?? requestedModel,
			startedAt,
			finishedAt,
			slowCommandEndsJson,
			taskKind,
			name: teammateName,
			filePath,
			mtimeMs: fileStat.mtimeMs,
		})
		.onConflictDoUpdate({
			target: schema.subagents.id,
			set: {
				taskKind,
				name: teammateName,
				projectId: project,
				agentType: agentType ?? attributionAgent,
				attributionAgent,
				slug,
				description: metaDescription,
				model: resolvedModel ?? requestedModel,
				startedAt,
				finishedAt,
				slowCommandEndsJson,
				filePath,
				mtimeMs: fileStat.mtimeMs,
			},
		})
		.run();

	replaceArtifactEvents(db, {filePath, sessionId, projectId: project, isSubagent: true}, artifactEvents.events());

	db.insert(schema.indexedFiles)
		.values({
			path: filePath,
			mtimeMs: fileStat.mtimeMs,
			sizeBytes: fileStat.size,
			indexedAt: Date.now(),
		})
		.onConflictDoUpdate({
			target: schema.indexedFiles.path,
			set: {
				mtimeMs: fileStat.mtimeMs,
				sizeBytes: fileStat.size,
				indexedAt: Date.now(),
			},
		})
		.run();
}

const AGENT_ID_RE = /agentId:\s*(\S+)/;

/** `value[key]` when `value` is an object whose `key` holds a string. */
function stringField(value: unknown, key: string): string | null {
	const field = isRecord(value) ? value[key] : undefined;
	return typeof field === "string" ? field : null;
}

export async function linkSubagentParents(db: IndexDb, jsonlPath: string, parentAgentId: string | null): Promise<void> {
	const rl = createLineReader(createReadStream(jsonlPath, {encoding: "utf-8"}));
	const collector = new SubagentLinkCollector();
	let applied = 0;
	try {
		for await (const line of rl) {
			if (!line.trim()) continue;
			try {
				collector.add(JSON.parse(line));
			} catch {
				// skip malformed lines
			}
			applySubagentLinks(db, collector.links.slice(applied), parentAgentId);
			applied = collector.links.length;
		}
	} finally {
		await rl.close();
	}
}

export async function indexTaskFile(db: IndexDb, filePath: string, projectDir: string): Promise<void> {
	let fileStat: Awaited<ReturnType<typeof stat>>;
	try {
		fileStat = await stat(filePath);
	} catch {
		return;
	}

	const existing = db.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).get();
	if (existing && existing.mtimeMs === fileStat.mtimeMs) {
		const taskRow = db.select().from(schema.tasks).where(eq(schema.tasks.filePath, filePath)).get();
		if (taskRow) return;
	}

	let raw: string;
	try {
		raw = await readFile(filePath, "utf-8");
	} catch {
		return;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return;
	}

	const result = TaskFileSchema.safeParse(parsed);
	if (!result.success) return;

	const task = result.data;

	db.insert(schema.tasks)
		.values({
			filePath,
			taskId: task.id,
			projectDir,
			subject: task.subject,
			description: task.description,
			status: task.status,
			activeForm: task.activeForm ?? null,
			owner: task.owner ?? null,
			blocksJson: JSON.stringify(task.blocks),
			blockedByJson: JSON.stringify(task.blockedBy),
			metadataJson: JSON.stringify(task.metadata ?? {}),
			mtimeMs: fileStat.mtimeMs,
		})
		.onConflictDoUpdate({
			target: schema.tasks.filePath,
			set: {
				taskId: task.id,
				subject: task.subject,
				description: task.description,
				status: task.status,
				activeForm: task.activeForm ?? null,
				owner: task.owner ?? null,
				blocksJson: JSON.stringify(task.blocks),
				blockedByJson: JSON.stringify(task.blockedBy),
				metadataJson: JSON.stringify(task.metadata ?? {}),
				mtimeMs: fileStat.mtimeMs,
			},
		})
		.run();

	db.insert(schema.indexedFiles)
		.values({
			path: filePath,
			mtimeMs: fileStat.mtimeMs,
			sizeBytes: fileStat.size,
			indexedAt: Date.now(),
		})
		.onConflictDoUpdate({
			target: schema.indexedFiles.path,
			set: {
				mtimeMs: fileStat.mtimeMs,
				sizeBytes: fileStat.size,
				indexedAt: Date.now(),
			},
		})
		.run();
}

export async function scanTasksDir(db: IndexDb, tasksDir: string): Promise<void> {
	let projectDirs: string[];
	try {
		projectDirs = await readdir(tasksDir);
	} catch {
		return;
	}

	const indexedPaths = new Set<string>();

	for (const projectDir of projectDirs) {
		const projectPath = join(tasksDir, projectDir);
		try {
			const dirStat = await stat(projectPath);
			if (!dirStat.isDirectory()) continue;
		} catch {
			continue;
		}

		let files: string[];
		try {
			files = await readdir(projectPath);
		} catch {
			continue;
		}

		for (const file of files) {
			if (!file.endsWith(".json")) continue;
			const filePath = join(projectPath, file);
			indexedPaths.add(filePath);
			await indexTaskFile(db, filePath, projectDir);
		}
	}

	// Clean up deleted files
	const allTasks = db.select({filePath: schema.tasks.filePath}).from(schema.tasks).all();
	for (const row of allTasks) {
		if (!indexedPaths.has(row.filePath)) {
			db.delete(schema.tasks).where(eq(schema.tasks.filePath, row.filePath)).run();
			db.delete(schema.indexedFiles).where(eq(schema.indexedFiles.path, row.filePath)).run();
		}
	}
}

type DocKind = "plan" | "memory";

interface DocContent {
	path: string;
	kind: DocKind;
	projectId: string;
	mtimeMs: number;
	title: string;
	content: string;
}

/**
 * Replace the `docs_content` row (and, via triggers, the `docs_fts` row) for
 * one plan or memory file. Deletes seek the unique `path` index, and the
 * trigger removes the FTS row by rowid, so no statement scans `docs_fts`.
 */
function replaceDocContent(db: IndexDb, doc: DocContent): void {
	db.transaction((transaction) => {
		transaction.run(sql`DELETE FROM docs_content WHERE path = ${doc.path}`);
		transaction.run(
			sql`INSERT INTO docs_content(path, kind, project_id, mtime_ms, title, content)
				VALUES (${doc.path}, ${doc.kind}, ${doc.projectId}, ${doc.mtimeMs}, ${doc.title}, ${doc.content})`,
		);
	});
}

function deleteDocContent(db: IndexDb, path: string): void {
	db.run(sql`DELETE FROM docs_content WHERE path = ${path}`);
}

/** Remove every index row owned by one memory markdown file. Idempotent. */
export function deleteMemoryFile(db: IndexDb, filePath: string): void {
	db.delete(schema.memories).where(eq(schema.memories.filePath, filePath)).run();
	db.delete(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).run();
	deleteDocContent(db, filePath);
}

export async function indexMemoryFile(db: IndexDb, filePath: string, projectId: string): Promise<void> {
	let fileStat: Awaited<ReturnType<typeof stat>>;
	try {
		fileStat = await stat(filePath);
	} catch {
		deleteMemoryFile(db, filePath);
		return;
	}

	const existing = db.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).get();
	if (existing && existing.mtimeMs === fileStat.mtimeMs) {
		const memoryRow = db.select().from(schema.memories).where(eq(schema.memories.filePath, filePath)).get();
		if (memoryRow) return;
	}

	let content: string;
	try {
		content = await readFile(filePath, "utf-8");
	} catch {
		deleteMemoryFile(db, filePath);
		return;
	}

	const filename = basename(filePath);
	const title = extractTitleFromContent(content, filename);

	db.insert(schema.memories)
		.values({
			filePath,
			projectId,
			filename,
			title,
			mtimeMs: fileStat.mtimeMs,
		})
		.onConflictDoUpdate({
			target: schema.memories.filePath,
			set: {
				projectId,
				filename,
				title,
				mtimeMs: fileStat.mtimeMs,
			},
		})
		.run();

	replaceDocContent(db, {
		path: filePath,
		kind: "memory",
		projectId,
		mtimeMs: fileStat.mtimeMs,
		title,
		content,
	});

	db.insert(schema.indexedFiles)
		.values({
			path: filePath,
			mtimeMs: fileStat.mtimeMs,
			sizeBytes: fileStat.size,
			indexedAt: Date.now(),
		})
		.onConflictDoUpdate({
			target: schema.indexedFiles.path,
			set: {
				mtimeMs: fileStat.mtimeMs,
				sizeBytes: fileStat.size,
				indexedAt: Date.now(),
			},
		})
		.run();
}

export async function scanMemoriesForProject(db: IndexDb, projectsDir: string, projectId: string): Promise<void> {
	const memoryDir = join(projectsDir, projectId, "memory");
	let files: string[];
	try {
		files = await readdir(memoryDir);
	} catch {
		// memory dir missing — prune any stale rows for this project and return
		const stale = db
			.select({filePath: schema.memories.filePath})
			.from(schema.memories)
			.where(eq(schema.memories.projectId, projectId))
			.all();
		for (const row of stale) {
			deleteMemoryFile(db, row.filePath);
		}
		return;
	}

	const indexedPaths = new Set<string>();
	for (const file of files) {
		if (!file.endsWith(".md")) continue;
		const filePath = join(memoryDir, file);
		indexedPaths.add(filePath);
		await indexMemoryFile(db, filePath, projectId);
	}

	// Prune memory rows for this project whose filePath is missing on disk
	const existingRows = db
		.select({filePath: schema.memories.filePath})
		.from(schema.memories)
		.where(eq(schema.memories.projectId, projectId))
		.all();
	for (const row of existingRows) {
		if (!indexedPaths.has(row.filePath)) {
			deleteMemoryFile(db, row.filePath);
		}
	}
}

/**
 * Remove plan_sessions rows whose plan file no longer exists on disk. Returns
 * the number of rows deleted. Leaves the table untouched when the plans
 * directory itself is unreadable — we never want a transient fs hiccup to wipe
 * the entire linkage table.
 */
export async function pruneStalePlanLinks(db: IndexDb, plansDir: string): Promise<number> {
	let entries: string[];
	try {
		entries = await readdir(plansDir);
	} catch {
		return 0;
	}

	const existingPlans = entries.filter((f) => f.endsWith(".md"));

	// notInArray with an empty list is a no-op SQL-wise, so short-circuit.
	if (existingPlans.length === 0) {
		const result = db.delete(schema.planSessions).run();
		return result.changes;
	}

	const result = db
		.delete(schema.planSessions)
		.where(notInArray(schema.planSessions.planFilename, existingPlans))
		.run();
	return result.changes;
}

/**
 * Delete the row for `filename` from the `plans` table, along with its
 * matching `indexed_files` cache entry. Idempotent — running twice is fine.
 */
export function deletePlan(db: IndexDb, plansDir: string, filename: string): void {
	const filePath = join(plansDir, filename);
	db.delete(schema.plans).where(eq(schema.plans.filename, filename)).run();
	db.delete(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).run();
	deleteDocContent(db, filePath);
}

/**
 * Per-file indexer for a single plan markdown file. Mirrors `indexTaskFile`.
 *
 * - If the file is missing on disk, delete the `plans` row and return.
 * - If the `indexed_files` cache shows the same mtime, short-circuit.
 * - Otherwise read content, compute a display title, upsert the `plans` row
 *   keyed on `filename`, and upsert the `indexed_files` row.
 */
export async function indexPlanFile(db: IndexDb, plansDir: string, filename: string): Promise<{changed: boolean}> {
	const filePath = join(plansDir, filename);
	let fileStat: Awaited<ReturnType<typeof stat>>;
	try {
		fileStat = await stat(filePath);
	} catch {
		deletePlan(db, plansDir, filename);
		return {changed: true};
	}

	const existing = db.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).get();
	if (existing && existing.mtimeMs === fileStat.mtimeMs) {
		return {changed: false};
	}

	let content: string;
	try {
		content = await readFile(filePath, "utf-8");
	} catch {
		deletePlan(db, plansDir, filename);
		return {changed: true};
	}

	const title = extractTitleFromContent(content, filename);

	db.insert(schema.plans)
		.values({filename, title, mtimeMs: fileStat.mtimeMs})
		.onConflictDoUpdate({
			target: schema.plans.filename,
			set: {title, mtimeMs: fileStat.mtimeMs},
		})
		.run();

	replaceDocContent(db, {
		path: filePath,
		kind: "plan",
		projectId: "",
		mtimeMs: fileStat.mtimeMs,
		title,
		content,
	});

	db.insert(schema.indexedFiles)
		.values({
			path: filePath,
			mtimeMs: fileStat.mtimeMs,
			sizeBytes: fileStat.size,
			indexedAt: Date.now(),
		})
		.onConflictDoUpdate({
			target: schema.indexedFiles.path,
			set: {
				mtimeMs: fileStat.mtimeMs,
				sizeBytes: fileStat.size,
				indexedAt: Date.now(),
			},
		})
		.run();

	return {changed: true};
}

/**
 * Scan the plans directory, indexing each `.md` file via `indexPlanFile` and
 * pruning `plans` rows (plus their `indexed_files` cache entries) whose
 * filename is no longer on disk. Mirrors `scanTasksDir`.
 *
 * The `indexed_files` mtime short-circuit inside `indexPlanFile` makes repeat
 * passes cheap — only changed files do real work.
 */
export async function scanPlansDir(db: IndexDb, plansDir: string): Promise<void> {
	let entries: string[];
	try {
		entries = await readdir(plansDir);
	} catch {
		return;
	}

	const indexedFilenames = new Set<string>();
	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;
		indexedFilenames.add(entry);
		await indexPlanFile(db, plansDir, entry);
	}

	// Prune plans rows whose filename is missing on disk.
	const existingPlans = db.select({filename: schema.plans.filename}).from(schema.plans).all();
	for (const row of existingPlans) {
		if (!indexedFilenames.has(row.filename)) {
			deletePlan(db, plansDir, row.filename);
		}
	}
}

let indexingInProgress = false;
export function isCurrentlyIndexing(): boolean {
	return indexingInProgress;
}

/** Max concurrent session files indexed during a full scan. */
const SCAN_CONCURRENCY = 8;

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
	// One shared iterator: each worker pulls the next unclaimed item.
	const remaining = items.values();
	const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
		for (const item of remaining) await fn(item);
	});
	await Promise.all(workers);
}

/** Snapshot of indexed_files mtimes, so the scan can detect changes in memory. */
function loadIndexedFileMtimes(db: IndexDb): Map<string, number> {
	const rows = db
		.select({path: schema.indexedFiles.path, mtimeMs: schema.indexedFiles.mtimeMs})
		.from(schema.indexedFiles)
		.all();
	return new Map(rows.map((r) => [r.path, r.mtimeMs]));
}

function isPrimaryTranscriptPath(projectsDir: string, filePath: string): boolean {
	const relativePath = relative(projectsDir, filePath);
	const pathParts = relativePath.split(sep);
	return (
		pathParts.length === 2 &&
		pathParts[0] !== ".." &&
		pathParts[0] !== "." &&
		pathParts[1]?.endsWith(".jsonl") === true
	);
}

/**
 * Prune sessions whose primary transcripts disappeared during a complete scan.
 * A session ID still present under another project is a moved session, so only
 * its stale path cache is removed and all session metadata is preserved.
 */
function pruneDeletedSessions(
	indexDb: IndexDb,
	summariesDb: IndexDb,
	projectsDir: string,
	discoveredPaths: Set<string>,
): void {
	const onDiskPaths = new Set(
		Array.from(discoveredPaths).filter((path) => isPrimaryTranscriptPath(projectsDir, path)),
	);
	const onDiskIds = new Set(Array.from(onDiskPaths, (path) => basename(path, ".jsonl")));
	const existingSessions = indexDb
		.select({id: schema.sessions.id, filePath: schema.sessions.filePath})
		.from(schema.sessions)
		.all();

	for (const session of existingSessions) {
		if (onDiskPaths.has(session.filePath)) continue;

		indexDb.delete(schema.indexedFiles).where(eq(schema.indexedFiles.path, session.filePath)).run();
		if (onDiskIds.has(session.id)) continue;

		const subagentPaths = indexDb
			.select({filePath: schema.subagents.filePath})
			.from(schema.subagents)
			.where(eq(schema.subagents.sessionId, session.id))
			.all();
		for (const subagent of subagentPaths) {
			indexDb.delete(schema.indexedFiles).where(eq(schema.indexedFiles.path, subagent.filePath)).run();
		}

		indexDb.delete(schema.subagents).where(eq(schema.subagents.sessionId, session.id)).run();
		indexDb.delete(schema.planSessions).where(eq(schema.planSessions.sessionId, session.id)).run();
		summariesDb.delete(schema.summaries).where(eq(schema.summaries.sessionId, session.id)).run();
		indexDb.run(sql`DELETE FROM message_content WHERE session_id = ${session.id}`);
		indexDb.delete(schema.sessions).where(eq(schema.sessions.id, session.id)).run();
		indexDb.delete(schema.sessionMessages).where(eq(schema.sessionMessages.sessionId, session.id)).run();
		indexDb.delete(schema.sessionMcpTools).where(eq(schema.sessionMcpTools.sessionId, session.id)).run();
		deleteArtifactEventsForSessions(indexDb, [session.id]);
		deleteRoutinesForSessions(indexDb, [session.id]);
		deleteUsageDailyForSessions(indexDb, [session.id]);
		deleteSessionBridgeAliases(indexDb, session.id);
	}

	// Re-indexing a moved session updates sessions.filePath before pruning runs,
	// so remove stale primary transcript cache rows independently of session rows.
	const indexedPaths = indexDb.select({path: schema.indexedFiles.path}).from(schema.indexedFiles).all();
	for (const indexedFile of indexedPaths) {
		if (isPrimaryTranscriptPath(projectsDir, indexedFile.path) && !onDiskPaths.has(indexedFile.path)) {
			indexDb.delete(schema.indexedFiles).where(eq(schema.indexedFiles.path, indexedFile.path)).run();
			indexDb.delete(schema.usageDaily).where(eq(schema.usageDaily.filePath, indexedFile.path)).run();
		}
	}
}

type ReadDirectory = (path: string) => Promise<string[]>;

export async function fullScan(
	indexDb: IndexDb,
	summariesDb: IndexDb,
	projectsDir: string,
	tasksDir?: string,
	plansDir?: string,
	readDirectory: ReadDirectory = readdir,
	signal?: AbortSignal,
): Promise<void> {
	// Each step is one unit of work that another connection's write lock can
	// hold up. It retries after an asynchronous pause instead of sleeping the
	// thread, and names itself for the dev event-loop stall monitor.
	const step = async <T>(label: string, run: () => T | Promise<T>): Promise<T> =>
		trackActivity(`scan ${label}`, async () => retryWhileBusy(run, signal));

	indexingInProgress = true;
	try {
		await step("project names", () => {
			repairProjectDisplayNames(indexDb);
		});

		let projectDirs: string[];
		try {
			projectDirs = await readDirectory(projectsDir);
		} catch {
			// The root was not enumerable, so this pass cannot prove anything was deleted.
			return;
		}

		// Validate project dirs and capture a recency signal, so the most-recently
		// active projects are indexed first and fresh sessions surface within
		// seconds rather than after the whole scan completes.
		let scanComplete = true;
		const projects: {project: string; projectPath: string; recency: number}[] = [];
		for (const project of projectDirs) {
			const projectPath = join(projectsDir, project);
			let recency: number;
			try {
				const dirStat = await stat(projectPath);
				if (!dirStat.isDirectory()) continue;
				recency = dirStat.mtimeMs;
			} catch {
				scanComplete = false;
				continue;
			}
			// sessions-index.json is rewritten as a project's sessions change, so it
			// is a better recency signal than the dir mtime on filesystems that don't
			// bump the dir when an existing file is appended to.
			try {
				const idxStat = await stat(join(projectPath, "sessions-index.json"));
				recency = Math.max(recency, idxStat.mtimeMs);
			} catch {
				// no sessions-index.json
			}
			projects.push({project, projectPath, recency});
		}
		projects.sort((a, b) => b.recency - a.recency);

		// One bulk read of indexed_files so per-session change detection (used to
		// skip the expensive subagent re-link) is an in-memory lookup.
		const knownMtimes = loadIndexedFileMtimes(indexDb);
		const onDiskPaths = new Set<string>();

		for (const {project, projectPath} of projects) {
			signal?.throwIfAborted();
			// Index sessions-index.json
			await step(`sessions-index ${projectPath}`, async () => indexSessionsIndex(indexDb, projectPath, project));

			// Discover session JSONL files with their mtimes, newest first.
			let files: string[];
			try {
				files = await readDirectory(projectPath);
			} catch {
				scanComplete = false;
				continue;
			}
			const sessionFiles = await Promise.all(
				files
					.filter((f) => f.endsWith(".jsonl"))
					.map(async (f) => {
						const path = join(projectPath, f);
						let mtimeMs = 0;
						try {
							mtimeMs = (await stat(path)).mtimeMs;
						} catch {
							// unreadable; indexJsonlFile will skip it too
						}
						return {sessionId: f.replace(/\.jsonl$/, ""), path, mtimeMs};
					}),
			);
			for (const sessionFile of sessionFiles) {
				onDiskPaths.add(sessionFile.path);
			}
			sessionFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

			// Index JSONL files with bounded concurrency.
			await mapLimit(sessionFiles, SCAN_CONCURRENCY, async ({path}) => {
				signal?.throwIfAborted();
				await step(`jsonl ${path}`, async () => indexJsonlFile(indexDb, path, project));
			});

			// Index subagents and (re)link parent-child relationships. Linking
			// re-streams whole JSONL files, so only do it for sessions whose root or
			// subagent files actually changed since the last scan.
			for (const {sessionId, path: sessionJsonlPath, mtimeMs: sessionMtime} of sessionFiles) {
				const subagentsDir = join(projectPath, sessionId, "subagents");
				let subFiles: string[];
				try {
					subFiles = await readDirectory(subagentsDir);
				} catch {
					continue;
				}

				let changed = knownMtimes.get(sessionJsonlPath) !== sessionMtime;
				const subagentJsonlPaths: string[] = [];
				for (const sf of subFiles) {
					if (!sf.startsWith("agent-") || !sf.endsWith(".jsonl")) continue;
					const sfPath = join(subagentsDir, sf);
					let sfMtime = 0;
					try {
						sfMtime = (await stat(sfPath)).mtimeMs;
					} catch {
						continue;
					}
					if (knownMtimes.get(sfPath) !== sfMtime) changed = true;
					await step(`subagent ${sfPath}`, async () =>
						indexSubagentFile(indexDb, sfPath, sessionId, project),
					);
					subagentJsonlPaths.push(sfPath);
				}

				if (changed && subagentJsonlPaths.length > 0) {
					for (const saPath of subagentJsonlPaths) {
						await step(`subagent links ${saPath}`, async () =>
							linkSubagentParents(indexDb, saPath, basename(saPath, ".jsonl")),
						);
					}
					await step(`subagent links ${sessionJsonlPath}`, async () =>
						linkSubagentParents(indexDb, sessionJsonlPath, null),
					);
				}
			}

			// Index memory markdown files for this project
			await step(`memories ${projectPath}`, async () => scanMemoriesForProject(indexDb, projectsDir, project));
		}

		// Pruning is only safe after every project directory was enumerated. A
		// transient permission or mount failure must leave the existing index intact.
		if (scanComplete) {
			await step("prune deleted sessions", () => {
				pruneDeletedSessions(indexDb, summariesDb, projectsDir, onDiskPaths);
			});
		}

		if (tasksDir) {
			await step(`tasks ${tasksDir}`, async () => scanTasksDir(indexDb, tasksDir));
		}

		if (plansDir) {
			await step(`plans ${plansDir}`, async () => scanPlansDir(indexDb, plansDir));
			await step("prune plan links", async () => pruneStalePlanLinks(indexDb, plansDir));
		}

		// The scan visits projects in recency order, so a worktree can be
		// persisted before the parent project it derives its display name from.
		// A final pass renames it once every parent is present.
		await step("project names", () => {
			repairProjectDisplayNames(indexDb);
		});
	} finally {
		indexingInProgress = false;
	}
}

export async function indexFile(
	db: IndexDb,
	filePath: string,
	projectsDir: string,
	plansDir?: string,
	options: {jsonlCache?: JsonlIndexCache} = {},
): Promise<{linkedPlans: string[]}> {
	// Task file: ~/.claude/tasks/{projectDir}/{id}.json
	if (filePath.includes("/tasks/") && filePath.endsWith(".json")) {
		const parts = filePath.split("/");
		const tasksIdx = parts.lastIndexOf("tasks");
		const projectDir = parts[tasksIdx + 1];
		if (projectDir) {
			await indexTaskFile(db, filePath, projectDir);
		}
		return {linkedPlans: []};
	}

	// Plan markdown file: ~/.claude/plans/{filename}.md
	if (filePath.endsWith(".md") && plansDir && filePath.startsWith(plansDir)) {
		const filename = basename(filePath);
		await indexPlanFile(db, plansDir, filename);
		return {linkedPlans: []};
	}

	const normalizedProjectFile = normalizeProjectFile(filePath, projectsDir);
	if (!normalizedProjectFile) return {linkedPlans: []};

	// Memory markdown file: {projectsDir}/{project}/memory/{filename}.md
	if (filePath.endsWith(".md")) {
		if (normalizedProjectFile.relativeParts.length === 3 && normalizedProjectFile.relativeParts[1] === "memory") {
			await indexMemoryFile(db, filePath, normalizedProjectFile.project);
			return {linkedPlans: []};
		}
	}

	// Determine what kind of file changed and index accordingly
	if (filePath.endsWith("sessions-index.json")) {
		const projectDir = join(projectsDir, normalizedProjectFile.project);
		await indexSessionsIndex(db, projectDir, normalizedProjectFile.project);
		return {linkedPlans: []};
	}

	if (filePath.endsWith(".jsonl")) {
		// Check if this is a subagent file
		if (filePath.includes("/subagents/") && basename(filePath).startsWith("agent-")) {
			const subagentsIdx = normalizedProjectFile.relativeParts.indexOf("subagents");
			if (subagentsIdx >= 2) {
				const sessionId = defined(
					normalizedProjectFile.relativeParts[subagentsIdx - 1],
					"A subagents directory at index >= 2 has a session directory before it",
				);
				await indexSubagentFile(db, filePath, sessionId, normalizedProjectFile.project);
				// Link nested parent-child relationships from this subagent's JSONL
				const agentFilename = basename(filePath, ".jsonl");
				await linkSubagentParents(db, filePath, agentFilename);
			}
			return {linkedPlans: []};
		}

		// Regular session JSONL
		const {linkedPlans, subagentLinks} = await indexJsonlFileWithLinks(
			db,
			filePath,
			normalizedProjectFile.project,
			options.jsonlCache === undefined ? {} : {cache: options.jsonlCache},
		);
		// Link parent-child relationships from root session JSONL
		if (subagentLinks === undefined) await linkSubagentParents(db, filePath, null);
		else applySubagentLinks(db, subagentLinks, null);
		return {linkedPlans};
	}

	return {linkedPlans: []};
}
