import {type Stats} from "node:fs";
import {canonicalPath} from "./canonical-path";
import {stat} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {awaitInitialIndexScan, awaitInitialScan, getDb} from "./db";
import {retryWhileBusy} from "./db/busy";
import {trackActivity, trackActivitySync} from "./perf/event-loop-stalls";
import {broadcastAppendedJsonl, readAppendedJsonlLines, sharedJsonlOffsets} from "./jsonl-append-reader";
import {
	deleteFileContent,
	deleteMemoryFile,
	deleteTaskFile,
	pruneDeletedTranscript,
	deletePlan,
	indexFile,
	indexFileContent,
	isFileContentIndexable,
	isPathInsideFileContentRoots,
	resolveProjectsDirectory,
	liveJsonlIndexCache,
	liveSubagentIndexCache,
} from "./db/indexer";
import {
	listSessionsForProjectFromDb,
	getArchivedSessionIds,
	getSessionProjectId,
	getTaskFilesForProject,
	resolveTaskDirProjectId,
} from "./db/queries";
import type {TaskRow} from "./db/queries";
import {getUnseenSessionIds} from "./db/viewed-state";
import {updatePendingApprovalForSession, removePendingApprovalForSession} from "./db/pending-approvals-cache";
import type * as dbSchema from "./db/schema";
import {extractTitle} from "./markdown-utils.server";
import {resolveProjectName} from "./memory";
import {
	DOMAIN_EVENTS,
	SSE_EVENTS,
	diffEntityMaps,
	type SessionSummaryPayload,
	type TaskSummaryPayload,
} from "./hook-events";

type IndexDb = BetterSQLite3Database<typeof dbSchema>;

/** Callback signature for broadcasting events. */
type BroadcastFn = (type: string, data: Record<string, unknown>) => void;
import {toSessionSummaryPayload} from "./session-summary";
import {getSessionTerminalHosts} from "./session-terminal-hosts";
import {hmrPersist, hmrDispose} from "./hmr-persist";
import {DEFAULT_IGNORED_DIR_NAMES, getConfigPath, readConfig} from "./config";
import {broadcastTyped, broadcast, addClient, removeClient} from "./sse-broadcast";
import {handleContextMirrorEvent} from "./context-breakdown-reader";
import {recentlyBroadcast, sessionUpdatedDedupeKey} from "./update-dedupe";
import {isRegistryFileName} from "./session-registry";
import {scheduleSessionRegistryRefresh} from "./session-registry-store";
import {createRecursiveWatcher, type RecursiveWatcher} from "./recursive-watch";
import {gitIndexPath, TrackedFileIndex} from "./git-tracked";
import {CooperativeQueue} from "./cooperative-queue";
import {samePrStatus} from "./pr-status";
import {workflowSessionIdForPath} from "./workflow-runs";

/**
 * TTL covering the gap between the hook fast-path broadcast and this
 * trailing chokidar broadcast. Mirrors `DEDUPE_TTL_MS` in
 * `src/lib/hook-dispatcher.ts`.
 */
const DEDUPE_TTL_MS = 500;

export {broadcastTyped, broadcast, addClient, removeClient};

// Persisted state: survives HMR reloads via import.meta.hot.data
const lastSessionsByProject = hmrPersist(
	"lastSessionsByProject",
	() => new Map<string, Map<string, SessionSummaryPayload>>(),
);
/** Per project, the last-broadcast tasks keyed by task file path: task ids repeat across task lists. */
const lastTasksByProject = hmrPersist(
	"lastTaskFilesByProject",
	() => new Map<string, Map<string, TaskSummaryPayload>>(),
);

// Transient state: module-scoped, recreated on HMR
let watcher: RecursiveWatcher | null = null;
let projectsDir = "";
let plansDir = "";
let statuslineDir = "";
let jobsDir = "";
/** The ccb-context-mirror mod's directory, as its real path: the recursive watcher reports real paths. */
let contextMirrorDir = "";
/** The registry directory as given and as its real path: the recursive watcher reports real paths. */
let sessionRegistryDirs = new Set<string>();
let fileContentRoots: string[] = [];
let fileContentRootSet = new Set<string>();
let fileContentRootByGitIndexPath = new Map<string, string>();
/**
 * Every Git index path plus each of its ancestor directories: the paths `shouldIgnoreWatch` keeps watched even under an
 * ignored `.git`. A set lookup, because the predicate runs once per native event inside libuv's FSEvents callback, and
 * scanning every root per event starved the event loop under heavy churn in other projects.
 */
let gitIndexWatchPaths = new Set<string>();
const trackedFileIndex = new TrackedFileIndex();
// One queue per database, so a burst of change events indexes file by file instead of all at once.
const fileContentQueues = new WeakMap<IndexDb, CooperativeQueue>();
interface JsonlThrottleState {
	timer?: ReturnType<typeof setTimeout>;
	lastFired: number;
}
const jsonlThrottleByPath = new Map<string, JsonlThrottleState>();
/** How long an answer's one-shot throttle bypass waits for the CLI to write the transcript. */
const JSONL_EXPEDITE_WINDOW_MS = 5000;
/** Session id -> when its one-shot bypass lapses, armed when the app answers a question, permission or plan. */
const jsonlExpediteUntilBySession = new Map<string, number>();

/**
 * Read a session's transcript right away after the app answered its question,
 * permission prompt or plan, instead of waiting out `JSONL_THROTTLE_MS`. A
 * trailing read already pending fires now; otherwise the session's next
 * throttled change fires at once. One-shot and per session: every other
 * session, and this one's later changes, stay throttled.
 */
export function expediteSessionJsonlRead(sessionId: string): void {
	for (const [path, state] of jsonlThrottleByPath) {
		if (state.timer === undefined || basename(path, ".jsonl") !== sessionId) continue;
		clearTimeout(state.timer);
		delete state.timer;
		void fireJsonlAppend(path, state);
		return;
	}
	jsonlExpediteUntilBySession.set(sessionId, Date.now() + JSONL_EXPEDITE_WINDOW_MS);
}

/** Consume the session's armed bypass, when one is armed and not lapsed. */
function takeJsonlExpedite(path: string): boolean {
	const sessionId = basename(path, ".jsonl");
	const until = jsonlExpediteUntilBySession.get(sessionId);
	if (until === undefined) return false;
	jsonlExpediteUntilBySession.delete(sessionId);
	return Date.now() <= until;
}

async function fireJsonlAppend(path: string, state: JsonlThrottleState): Promise<void> {
	state.lastFired = Date.now();
	delete state.timer;
	await trackActivity(`jsonl append ${path}`, async () =>
		processJsonlAppend(getDb().index, path, sharedJsonlOffsets, broadcastTyped),
	);
}

/** Leading-plus-trailing throttle per session: a run's agents append to their transcripts many times a second. */
const WORKFLOW_THROTTLE_MS = 2000;
const workflowThrottleBySession = new Map<string, JsonlThrottleState>();

/**
 * Route a watcher event for a session's workflow files (a run file or anything
 * in a run's transcript directory): broadcast `workflows:changed` for that
 * session, throttled. True when the path is one, so callers know; the event
 * still flows on to the regular handlers (agent transcripts are indexed).
 */
function handleWorkflowFileEvent(path: string, projectsRoot: string, broadcast: BroadcastFn): boolean {
	if (!projectsRoot) return false;
	const sessionId = workflowSessionIdForPath(path, projectsRoot);
	if (sessionId === null) return false;
	const state = workflowThrottleBySession.get(sessionId) ?? {lastFired: 0};
	workflowThrottleBySession.set(sessionId, state);
	if (state.timer !== undefined) return true;
	const fire = (): void => {
		state.lastFired = Date.now();
		delete state.timer;
		broadcast(DOMAIN_EVENTS.WORKFLOWS_CHANGED, {sessionId});
	};
	const elapsed = Date.now() - state.lastFired;
	if (elapsed >= WORKFLOW_THROTTLE_MS) fire();
	else state.timer = setTimeout(fire, WORKFLOW_THROTTLE_MS - elapsed);
	return true;
}

function resetWorkflowThrottle(): void {
	for (const state of workflowThrottleBySession.values()) {
		if (state.timer !== undefined) clearTimeout(state.timer);
	}
	workflowThrottleBySession.clear();
}

hmrDispose(closeWatcher);

/** Stop watching and drop pending throttled JSONL updates. */
export async function closeWatcher(): Promise<void> {
	const current = watcher;
	watcher = null;
	for (const state of jsonlThrottleByPath.values()) {
		if (state.timer !== undefined) clearTimeout(state.timer);
	}
	jsonlThrottleByPath.clear();
	jsonlExpediteUntilBySession.clear();
	resetWorkflowThrottle();
	if (current) await current.close();
}

const WATCHED_EXTENSIONS = new Set([".md", ".jsonl", ".json"]);

/** Indexing that handleFileChange detaches from its caller, kept so tests can wait for it to finish. */
const detachedWork = new Set<Promise<void>>();

function detach(work: () => Promise<void>): void {
	const promise = work().finally(() => {
		detachedWork.delete(promise);
	});
	detachedWork.add(promise);
}
const JSONL_THROTTLE_MS = 2000;

/**
 * Default directory basenames whose subtrees we never descend into. These are
 * the usual suspects for vendored deps, build artifacts, and tool caches that
 * inflate watched-file counts inside the plugin cache (100k+ files) without
 * ever holding anything we render. `.git` also contains unwatchable Unix
 * sockets like `fsmonitor--daemon.ipc` that crash `fs.watch` outright.
 */
/**
 * Read the `ignored_dirs` array from this app's own config file
 * (`~/.config/claude-code-plans/config.json`). Returns `null` when the file
 * is missing, unreadable, not valid JSON, fails strict schema validation, or
 * has no usable `ignored_dirs` array — callers fall back to the next source.
 */
function readIgnoredDirsFromConfig(configPath: string): string[] | null {
	const dirs = readConfig(configPath)?.ignored_dirs;
	return dirs && dirs.length > 0 ? dirs : null;
}

/**
 * Resolve the directory basenames to ignore from persisted application
 * settings, falling back to the built-in defaults.
 */
export function resolveIgnoredDirNames(configPath: string = getConfigPath()): Set<string> {
	const fromConfig = readIgnoredDirsFromConfig(configPath);
	if (fromConfig) return new Set(fromConfig);
	return new Set(DEFAULT_IGNORED_DIR_NAMES);
}

/** Build the path-matching regex for a given set of ignored directory names. */
export function buildIgnoredDirPattern(dirNames: Set<string>): RegExp {
	const escaped = [...dirNames].map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	return new RegExp(`(?:^|/)(?:${escaped.join("|")})(?:/|$)`);
}

// Resolved once at module load. Watcher policy changes require a server restart.
let ignoredDirPattern = buildIgnoredDirPattern(resolveIgnoredDirNames());

/**
 * Predicate passed to chokidar's `ignored` option.
 *
 * - Skips bulky vendored/generated subtrees (see `resolveIgnoredDirNames`).
 * - Skips files whose extension isn't in `WATCHED_EXTENSIONS` — the handlers
 *   return early on those anyway, so watching them is pure waste.
 * - Defense in depth: skips non-regular files (sockets, FIFOs).
 */
export function shouldIgnoreWatch(path: string, stats?: Stats): boolean {
	if (gitIndexWatchPaths.has(resolve(path))) return false;
	if (ignoredDirPattern.test(path)) return true;
	if (stats && !stats.isFile() && !stats.isDirectory()) return true;
	if (stats?.isFile() && fileContentRootForPath(path) !== undefined) {
		return !isFileContentIndexable(path);
	}
	if (stats?.isFile()) {
		const dot = path.lastIndexOf(".");
		const ext = dot >= 0 ? path.slice(dot) : "";
		if (!WATCHED_EXTENSIONS.has(ext)) return true;
	}
	return false;
}

function sessionSummariesEqual(a: SessionSummaryPayload, b: SessionSummaryPayload): boolean {
	return (
		a.id === b.id &&
		a.title === b.title &&
		a.summary === b.summary &&
		a.mtime === b.mtime &&
		a.messageCount === b.messageCount &&
		a.gitBranch === b.gitBranch &&
		a.pr?.url === b.pr?.url &&
		samePrStatus(a.prStatus, b.prStatus) &&
		a.projectName === b.projectName &&
		a.archived === b.archived &&
		a.remoteControl === b.remoteControl &&
		a.remoteControlState === b.remoteControlState &&
		a.terminalHost === b.terminalHost &&
		a.state === b.state &&
		a.unseen === b.unseen &&
		a.blockedSince === b.blockedSince
	);
}

function toTaskSummaryPayload(row: TaskRow): TaskSummaryPayload {
	return {
		taskId: row.taskId,
		projectDir: row.projectDir,
		subject: row.subject,
		description: row.description,
		status: row.status,
		activeForm: row.activeForm,
		owner: row.owner,
		blocks: row.blocks,
		blockedBy: row.blockedBy,
	};
}

function tasksEqual(a: TaskSummaryPayload, b: TaskSummaryPayload): boolean {
	return (
		a.subject === b.subject &&
		a.description === b.description &&
		a.status === b.status &&
		a.activeForm === b.activeForm &&
		a.owner === b.owner &&
		JSON.stringify(a.blocks) === JSON.stringify(b.blocks) &&
		JSON.stringify(a.blockedBy) === JSON.stringify(b.blockedBy)
	);
}

/**
 * Diff the current DB sessions for a project against the last-known snapshot
 * and broadcast domain-level session:added / session:removed / session:updated
 * events for each delta.
 */
function diffAndBroadcastSessions(index: IndexDb, projectId: string, broadcast: BroadcastFn): void {
	// Archived sessions stay in the snapshot so archiving never reads as a removal.
	const rows = listSessionsForProjectFromDb(index, projectId, {status: "all"});
	const unseenIds = getUnseenSessionIds(index);
	const archivedIds = getArchivedSessionIds(index);
	const terminalHosts = getSessionTerminalHosts();
	const next = new Map<string, SessionSummaryPayload>();
	for (const row of rows) {
		next.set(
			row.id,
			toSessionSummaryPayload(row, {
				unseen: unseenIds.has(row.id),
				archived: archivedIds.has(row.id),
				terminalHost: terminalHosts.get(row.id) ?? null,
			}),
		);
	}

	const previous = lastSessionsByProject.get(projectId) ?? new Map<string, SessionSummaryPayload>();
	const {added, removed, updated} = diffEntityMaps(previous, next, sessionSummariesEqual);

	for (const session of added) {
		const key = `${DOMAIN_EVENTS.SESSION_ADDED}:${session.id}:${session.mtime}`;
		if (recentlyBroadcast(key, DEDUPE_TTL_MS)) continue;
		broadcast(DOMAIN_EVENTS.SESSION_ADDED, {session});
	}
	for (const sessionId of removed) {
		const key = `${DOMAIN_EVENTS.SESSION_REMOVED}:${sessionId}:${projectId}`;
		if (recentlyBroadcast(key, DEDUPE_TTL_MS)) continue;
		broadcast(DOMAIN_EVENTS.SESSION_REMOVED, {
			sessionId,
			projectDir: projectId,
		});
	}
	for (const session of updated) {
		const key = sessionUpdatedDedupeKey(session);
		if (recentlyBroadcast(key, DEDUPE_TTL_MS)) continue;
		broadcast(DOMAIN_EVENTS.SESSION_UPDATED, {session});
	}

	lastSessionsByProject.set(projectId, next);
}

function readTaskSnapshot(projectId: string): Map<string, TaskSummaryPayload> {
	const snapshot = new Map<string, TaskSummaryPayload>();
	for (const {filePath, task} of getTaskFilesForProject(getDb().index, projectId)) {
		snapshot.set(filePath, toTaskSummaryPayload(task));
	}
	return snapshot;
}

/** Same key as the hook dispatcher's, so whichever path broadcasts first suppresses the other. */
function taskChangedDedupeKey(filePath: string, status: string): string {
	return `${DOMAIN_EVENTS.TASK_CHANGED}:${filePath}:${status}`;
}

/**
 * Diff the current DB tasks for a project against the last-known snapshot
 * and broadcast task:changed / task:completed / task:removed deltas. A task transitioning to
 * status 'completed' gets a task:completed event in addition to task:changed.
 */
function diffAndBroadcastTasks(projectId: string): void {
	const next = readTaskSnapshot(projectId);
	const previous = lastTasksByProject.get(projectId) ?? new Map<string, TaskSummaryPayload>();
	const {removed} = diffEntityMaps(previous, next, tasksEqual);

	for (const [filePath, task] of next) {
		const before = previous.get(filePath);
		if (before !== undefined && tasksEqual(before, task)) continue;
		// The dispatcher already broadcast this change, including its task:completed.
		if (recentlyBroadcast(taskChangedDedupeKey(filePath, task.status), DEDUPE_TTL_MS)) continue;
		broadcastTyped(DOMAIN_EVENTS.TASK_CHANGED, {task});
		if (task.status === "completed" && before?.status !== "completed") {
			broadcastTyped(DOMAIN_EVENTS.TASK_COMPLETED, {
				taskId: task.taskId,
				subject: task.subject,
			});
		}
	}
	for (const filePath of removed) {
		const task = previous.get(filePath);
		if (task !== undefined)
			broadcastTyped(DOMAIN_EVENTS.TASK_REMOVED, {taskId: task.taskId, projectDir: task.projectDir});
	}

	lastTasksByProject.set(projectId, next);
}

/**
 * Broadcast a plan:changed event with the plan's filename, title, and mtime.
 * Falls through silently if the file has since disappeared. Accepts an
 * injectable broadcast callback so tests can capture emissions.
 */
async function broadcastPlanChangedWith(filePath: string, broadcast: BroadcastFn): Promise<void> {
	const filename = basename(filePath);
	let mtime: Date;
	let mtimeMs: number;
	try {
		const fileStat = await stat(filePath);
		mtime = fileStat.mtime;
		mtimeMs = fileStat.mtimeMs;
	} catch {
		return;
	}
	// Key on the integer mtimeMs (truncated) rather than the ISO string. The
	// hook fast-path reads its mtime back from the `plans` row where SQLite
	// truncates the sub-ms portion; the watcher would otherwise round up to the
	// next ms and produce a different ISO string for the same edit.
	const key = `${DOMAIN_EVENTS.PLAN_CHANGED}:${filename}:${Math.floor(mtimeMs)}`;
	if (recentlyBroadcast(key, DEDUPE_TTL_MS)) return;
	const title = await extractTitle(filePath, filename);
	broadcast(DOMAIN_EVENTS.PLAN_CHANGED, {
		plan: {filename, title, mtime: mtime.toISOString()},
	});
}

async function broadcastPlanChanged(filePath: string): Promise<void> {
	await broadcastPlanChangedWith(filePath, broadcastTyped);
}

/**
 * Handle a `.jsonl` change by indexing the file and broadcasting
 * `plan:changed` for each plan filename returned by the indexer. Pure
 * function over (db, paths, broadcast) — no module state. Used by the
 * watcher and exercised directly by tests.
 */
async function handleJsonlPlanLinks(
	db: IndexDb,
	jsonlPath: string,
	projectsDir: string,
	plansDir: string,
	broadcast: BroadcastFn,
): Promise<{linkedPlans: string[]}> {
	const result = await indexFile(db, jsonlPath, projectsDir, plansDir);
	for (const planFilename of result.linkedPlans) {
		await broadcastPlanChangedWith(join(plansDir, planFilename), broadcast);
	}
	return result;
}

/**
 * Handle a `.md` add/change for a plan file: route through the indexer
 * (which upserts the temporal `plans` row) first, then broadcast
 * `plan:changed`. Ordering matters — the row must be current before the
 * client's refetch fires.
 */
async function handlePlanMdChange(
	db: IndexDb,
	mdPath: string,
	projectsDir: string,
	plansDir: string,
	broadcast: BroadcastFn,
): Promise<void> {
	await indexFile(db, mdPath, projectsDir, plansDir);
	await broadcastPlanChangedWith(mdPath, broadcast);
}

/**
 * Handle a `.md` unlink for a plan file: delete the row from the `plans`
 * table, then broadcast `plan:removed`. Idempotent at the DB level —
 * repeating is a no-op.
 */
function handlePlanMdUnlink(db: IndexDb, mdPath: string, broadcast: BroadcastFn): void {
	const filename = basename(mdPath);
	deletePlan(db, plansDir, filename);
	broadcast(DOMAIN_EVENTS.PLAN_REMOVED, {filename});
}

/**
 * Broadcast a memory:changed event with the memory's filename, title, mtime,
 * and owning project. Silently skips files that are missing on disk.
 */
async function broadcastMemoryChanged(filePath: string, projectsDir: string): Promise<void> {
	const filename = basename(filePath);
	let mtime: Date;
	let mtimeMs: number;
	try {
		const fileStat = await stat(filePath);
		mtime = fileStat.mtime;
		mtimeMs = fileStat.mtimeMs;
	} catch {
		return;
	}
	const relative = filePath.slice(projectsDir.length + 1);
	const project = relative.split("/")[0] ?? "";
	if (!project) return;
	// Key on the integer mtimeMs (truncated) — see `broadcastPlanChangedWith`
	// for the precision-mismatch rationale shared with the dispatcher.
	const key = `${DOMAIN_EVENTS.MEMORY_CHANGED}:${filePath}:${Math.floor(mtimeMs)}`;
	if (recentlyBroadcast(key, DEDUPE_TTL_MS)) return;
	const projectName = await resolveProjectName(project);
	const title = filename.replace(/\.md$/, "");
	broadcastTyped(DOMAIN_EVENTS.MEMORY_CHANGED, {
		memory: {
			filename,
			title,
			mtime: mtime.toISOString(),
			project,
			projectName,
		},
	});
}

const JOB_FILES = new Set(["state.json", "timeline.jsonl"]);

/**
 * Route a watcher event under `~/.claude/jobs`. Returns true when the path is
 * inside the jobs directory, so other handlers never mistake a job's
 * `timeline.jsonl` for a session transcript. Only a job's own `state.json` or
 * `timeline.jsonl` broadcasts `jobs:changed`.
 */
function handleJobFileEvent(path: string, jobsRoot: string, broadcast: BroadcastFn): boolean {
	if (!jobsRoot || !path.startsWith(`${jobsRoot}/`)) return false;
	const [jobId, file, ...rest] = path.slice(jobsRoot.length + 1).split("/");
	if (jobId && file && rest.length === 0 && JOB_FILES.has(file)) {
		broadcast(DOMAIN_EVENTS.JOBS_CHANGED, {jobId});
	}
	return true;
}

/** Safely diff and broadcast sessions for a project; swallow indexing races. */
function safeDiffSessions(projectId: string, broadcast: BroadcastFn = broadcastTyped, db?: IndexDb): void {
	if (!projectId) return;
	try {
		trackActivitySync(`session diff ${projectId}`, () => {
			diffAndBroadcastSessions(db ?? getDb().index, projectId, broadcast);
		});
	} catch {
		// transient DB error; next file event will retry
	}
}

/** Re-broadcast a project's session rows, e.g. after a PR status refresh. */
export function rebroadcastProjectSessions(projectId: string): void {
	safeDiffSessions(projectId);
}

/**
 * Re-broadcast the rows of every project holding one of `sessionIds`, e.g.
 * after their live registry status changed. Sessions not yet indexed are skipped.
 */
export function rebroadcastSessionsById(
	sessionIds: ReadonlySet<string>,
	broadcast: BroadcastFn = broadcastTyped,
	db?: IndexDb,
): void {
	const projectIds = new Set<string>();
	try {
		const index = db ?? getDb().index;
		for (const sessionId of sessionIds) {
			const projectId = getSessionProjectId(index, sessionId);
			if (projectId) projectIds.add(projectId);
		}
	} catch {
		// transient DB error; the next registry change or poll retries
		return;
	}
	for (const projectId of projectIds) safeDiffSessions(projectId, broadcast, db);
}

/**
 * Snapshot a task dir's project before a task file change is indexed, so the
 * first diff after a restart compares against the indexed state instead of
 * nothing and broadcasts only what changed.
 */
function seedTaskSnapshot(taskDir: string): void {
	if (!taskDir) return;
	try {
		const projectId = resolveTaskDirProjectId(getDb().index, taskDir);
		if (!lastTasksByProject.has(projectId)) lastTasksByProject.set(projectId, readTaskSnapshot(projectId));
	} catch {
		// transient DB error; the diff then treats the project as new
	}
}

/** Safely diff and broadcast tasks for a task dir's project; swallow indexing races. */
function safeDiffTasks(taskDir: string): void {
	if (!taskDir) return;
	try {
		const projectId = resolveTaskDirProjectId(getDb().index, taskDir);
		trackActivitySync(`task diff ${projectId}`, () => {
			diffAndBroadcastTasks(projectId);
		});
	} catch {
		// transient DB error; next file event will retry
	}
}

/** Extract the first path segment under projectsDir, or '' if path is outside it. */
function projectIdFromPath(path: string, projectsDir: string): string {
	if (!projectsDir || !path.startsWith(projectsDir)) return "";
	const relative = path.slice(projectsDir.length + 1);
	return relative.split("/")[0] ?? "";
}

/** Extract session ID from a JSONL file path (filename minus .jsonl extension). */
function sessionIdFromJsonlPath(path: string): string {
	return basename(path, ".jsonl");
}

async function indexSilently(
	path: string,
	projectsDir: string,
	db?: IndexDb,
	plansDirectory: string = plansDir,
): Promise<{linkedPlans: string[]; subagentsChangedFor?: string}> {
	try {
		const index = db ?? getDb().index;
		return await trackActivity(`index ${path}`, async () =>
			retryWhileBusy(async () =>
				indexFile(index, path, projectsDir, plansDirectory || undefined, {
					jsonlCache: liveJsonlIndexCache,
					subagentCache: liveSubagentIndexCache,
				}),
			),
		);
	} catch {
		// indexing error — deltas below still reflect prior DB state
		return {linkedPlans: []};
	}
}

function fileContentQueue(db: IndexDb): CooperativeQueue {
	let queue = fileContentQueues.get(db);
	if (!queue) {
		queue = new CooperativeQueue();
		fileContentQueues.set(db, queue);
	}
	return queue;
}

async function handleFileContentChange(db: IndexDb, path: string, roots: readonly string[]): Promise<void> {
	await fileContentQueue(db).enqueue(path, async () => {
		await trackActivity(`file-content index ${path}`, async () =>
			retryWhileBusy(async () => indexFileContent(db, path, roots)),
		);
	});
}

function handleFileContentUnlink(db: IndexDb, path: string): void {
	deleteFileContent(db, path);
}

/** The file-content root holding `path`, found by walking its ancestors so the cost tracks depth, not root count. */
function fileContentRootForPath(path: string): string | undefined {
	for (let current = resolve(path); ; current = dirname(current)) {
		if (fileContentRootSet.has(current)) return current;
		if (dirname(current) === current) return undefined;
	}
}

function setFileContentRoots(roots: readonly string[]): void {
	fileContentRoots = roots.map((root) => resolve(root));
	fileContentRootSet = new Set(fileContentRoots);
	fileContentRootByGitIndexPath = new Map(fileContentRoots.map((root) => [resolve(gitIndexPath(root)), root]));
	gitIndexWatchPaths = new Set();
	for (const indexPath of fileContentRootByGitIndexPath.keys()) {
		for (let path = indexPath; !gitIndexWatchPaths.has(path); path = dirname(path)) {
			gitIndexWatchPaths.add(path);
			if (dirname(path) === path) break;
		}
	}
}

async function refreshTrackedFileRoot(db: IndexDb, root: string): Promise<void> {
	const previouslyTrackedPaths = trackedFileIndex.snapshot(root);
	const currentlyTrackedPaths = await trackedFileIndex.refresh(root);

	for (const path of currentlyTrackedPaths) {
		if (!previouslyTrackedPaths.has(path)) {
			await handleFileContentChange(db, path, fileContentRoots);
		}
	}
	for (const path of previouslyTrackedPaths) {
		if (!currentlyTrackedPaths.has(path)) handleFileContentUnlink(db, path);
	}
}

/** Directories the JSONL append handler resolves projects and linked plans against. */
export interface JsonlAppendDirs {
	projectsDir: string;
	plansDir: string;
}

/**
 * One throttled JSONL fire: read the lines appended since `offsets`, broadcast them, re-index the file, rescan it for a
 * pending approval, then broadcast the session delta and any linked plans. Pure over (db, path, offsets, broadcast)
 * apart from the dedupe and session-snapshot caches; the watcher passes its own module state.
 */
export async function processJsonlAppend(
	db: IndexDb,
	path: string,
	offsets: Map<string, number>,
	broadcast: BroadcastFn,
	dirs: JsonlAppendDirs = {projectsDir, plansDir},
): Promise<void> {
	try {
		const read = await readAppendedJsonlLines(db, path, offsets);
		await broadcastAppendedJsonl(path, sessionIdFromJsonlPath(path), read, broadcast, DEDUPE_TTL_MS);
	} catch {
		// File may have been deleted between the watcher event and this read.
	}

	const {linkedPlans, subagentsChangedFor} = await indexSilently(path, dirs.projectsDir, db, dirs.plansDir);
	// A teammate's command started or ended: tabs refetch the subagents the running-tasks count reads.
	if (subagentsChangedFor !== undefined) {
		broadcast(DOMAIN_EVENTS.SUBAGENTS_CHANGED, {sessionId: subagentsChangedFor});
	}
	const projectId = projectIdFromPath(path, dirs.projectsDir);
	if (projectId) {
		try {
			const projectName = await resolveProjectName(projectId);
			await updatePendingApprovalForSession(
				db,
				sessionIdFromJsonlPath(path),
				path,
				projectId,
				projectName,
				broadcast,
			);
		} catch {
			// transient error scanning JSONL; next change will retry
		}
	}
	safeDiffSessions(projectId, broadcast, db);
	if (dirs.plansDir) {
		for (const planFilename of linkedPlans) {
			await broadcastPlanChangedWith(join(dirs.plansDir, planFilename), broadcast);
		}
	}
}

/**
 * Route an event inside the CLI session registry: a `<pid>.json` write or
 * removal schedules a registry refresh, and everything else there (notably the
 * `<pid>.<hash>.key` secrets) is left untouched. True when `path` is inside
 * the registry directory.
 */
function handleSessionRegistryEvent(path: string): boolean {
	if (!sessionRegistryDirs.has(dirname(path))) return false;
	if (isRegistryFileName(basename(path))) scheduleSessionRegistryRefresh();
	return true;
}

/**
 * Whether a `.jsonl` change is a Claude Code transcript: under the projects
 * directory, as configured or resolved. The watcher also sees the file-content
 * roots, where an application's own `.jsonl` log can be gigabytes; reading one
 * of those as appended transcript lines -- from byte 0, as an unindexed file --
 * parsed it whole into the heap and ran the server out of memory.
 */
function isTranscriptPath(path: string): boolean {
	if (!projectsDir) return true;
	const roots = [resolve(projectsDir)];
	try {
		roots.push(resolveProjectsDirectory(projectsDir));
	} catch {
		// A missing projects directory has no resolved form; the configured one still applies.
	}
	const normalized = resolve(path);
	return roots.some((root) => normalized.startsWith(`${root}/`));
}

async function handleFileChange(path: string): Promise<void> {
	if (handleSessionRegistryEvent(path)) return;
	if (handleJobFileEvent(path, jobsDir, broadcastTyped)) return;
	if (handleContextMirrorEvent(path, contextMirrorDir, broadcastTyped)) return;
	// Transcripts wait only for the index scan: the file-content scan after it can take minutes.
	await awaitInitialIndexScan();
	handleWorkflowFileEvent(path, projectsDir, broadcastTyped);
	const normalizedPath = resolve(path);
	const gitIndexRoot = fileContentRootByGitIndexPath.get(normalizedPath);
	if (gitIndexRoot) {
		await awaitInitialScan();
		try {
			await trackActivity(`git index refresh ${gitIndexRoot}`, async () =>
				refreshTrackedFileRoot(getDb().index, gitIndexRoot),
			);
		} catch {
			// A later watcher event or startup scan retries transient indexing failures.
		}
		return;
	}
	const fileContentRoot = fileContentRootForPath(path);
	if (fileContentRoot && trackedFileIndex.has(fileContentRoot, path)) {
		await awaitInitialScan();
		try {
			await handleFileContentChange(getDb().index, path, fileContentRoots);
		} catch {
			// A later watcher event or startup scan retries transient indexing failures.
		}
	}
	const ext = path.slice(path.lastIndexOf("."));
	if (!WATCHED_EXTENSIONS.has(ext)) return;

	if (ext === ".jsonl") {
		if (!isTranscriptPath(path)) return;
		// Throttle: fire immediately on the first change, then at most once
		// per JSONL_THROTTLE_MS. A trailing timer ensures the final batch of
		// changes is always processed even after writes stop.
		const now = Date.now();
		const throttleState = jsonlThrottleByPath.get(path) ?? {lastFired: 0};
		jsonlThrottleByPath.set(path, throttleState);
		const elapsed = now - throttleState.lastFired;

		const fire = async () => fireJsonlAppend(path, throttleState);

		if (throttleState.timer !== undefined) clearTimeout(throttleState.timer);

		if (elapsed >= JSONL_THROTTLE_MS || takeJsonlExpedite(path)) {
			// Enough time has passed, or the app just answered this session -- fire immediately.
			void fire();
		} else {
			// Schedule a trailing fire for the remaining interval.
			throttleState.timer = setTimeout(() => void fire(), JSONL_THROTTLE_MS - elapsed);
		}
	} else if (ext === ".json" && statuslineDir && path.startsWith(statuslineDir)) {
		const filename = basename(path);
		const sessionId = filename.replace(/\.json$/, "");
		broadcastTyped(SSE_EVENTS.STATUSLINE_UPDATED, {sessionId});
	} else if (ext === ".json" && path.includes("/tasks/")) {
		// ~/.claude/tasks/{taskDir}/{taskId}.json
		const taskDir = basename(dirname(path));
		seedTaskSnapshot(taskDir);
		detach(async () => {
			await indexSilently(path, projectsDir);
			safeDiffTasks(taskDir);
		});
	} else if (ext === ".json" && path.endsWith("sessions-index.json")) {
		detach(async () => {
			await indexSilently(path, projectsDir);
			safeDiffSessions(basename(dirname(path)));
		});
	} else if (ext === ".md") {
		if (plansDir && path.startsWith(plansDir)) {
			detach(async () => {
				try {
					await handlePlanMdChange(getDb().index, path, projectsDir, plansDir, broadcastTyped);
				} catch {
					// transient indexing error
					await broadcastPlanChanged(path);
				}
			});
		} else if (projectsDir && path.startsWith(projectsDir)) {
			detach(async () => {
				await indexSilently(path, projectsDir);
				await broadcastMemoryChanged(path, projectsDir);
			});
		}
	}
}

/** Watcher listeners: the emitter ignores returned promises, so these detach the async handlers explicitly. */
function onFileChange(path: string): void {
	void handleFileChange(path);
}

function onFileUnlink(path: string): void {
	void handleFileUnlink(path);
}

async function handleFileUnlink(path: string): Promise<void> {
	if (handleSessionRegistryEvent(path)) return;
	if (handleJobFileEvent(path, jobsDir, broadcastTyped)) return;
	if (handleContextMirrorEvent(path, contextMirrorDir, broadcastTyped)) return;
	await awaitInitialIndexScan();
	if (isPathInsideFileContentRoots(path, fileContentRoots)) {
		await awaitInitialScan();
		try {
			handleFileContentUnlink(getDb().index, path);
		} catch {
			// A later startup scan reconciles transient deletion failures.
		}
	}
	const ext = path.slice(path.lastIndexOf("."));
	if (!WATCHED_EXTENSIONS.has(ext)) return;

	if (ext === ".md" && plansDir && path.startsWith(plansDir)) {
		try {
			handlePlanMdUnlink(getDb().index, path, broadcastTyped);
		} catch {
			// transient DB error; ensure broadcast still fires
			broadcastTyped(DOMAIN_EVENTS.PLAN_REMOVED, {filename: basename(path)});
		}
	} else if (ext === ".md" && projectsDir && path.startsWith(projectsDir)) {
		const relative = path.slice(projectsDir.length + 1);
		const project = relative.split("/")[0] ?? "";
		if (project) {
			try {
				deleteMemoryFile(getDb().index, path);
			} catch {
				// transient DB error; broadcast still fires
			}
			broadcastTyped(DOMAIN_EVENTS.MEMORY_REMOVED, {
				project,
				filename: basename(path),
			});
		}
	} else if (ext === ".jsonl") {
		sharedJsonlOffsets.delete(path);
		liveJsonlIndexCache.delete(path);
		liveSubagentIndexCache.delete(path);
		const throttleState = jsonlThrottleByPath.get(path);
		if (throttleState?.timer !== undefined) clearTimeout(throttleState.timer);
		jsonlThrottleByPath.delete(path);
		try {
			const db = getDb();
			pruneDeletedTranscript(db.index, db.summaries, projectsDir, path);
		} catch {
			// transient DB error; the next full scan prunes the session
		}
		safeDiffSessions(projectIdFromPath(path, projectsDir));
		removePendingApprovalForSession(sessionIdFromJsonlPath(path));
	} else if (ext === ".json" && path.endsWith("sessions-index.json")) {
		safeDiffSessions(basename(dirname(path)));
	} else if (ext === ".json" && path.includes("/tasks/")) {
		const taskDir = basename(dirname(path));
		seedTaskSnapshot(taskDir);
		try {
			deleteTaskFile(getDb().index, path);
		} catch {
			// transient DB error; the diff below still runs
		}
		safeDiffTasks(taskDir);
	}
}

export async function createWatcher(
	dirs: string[],
	projDir?: string,
	plDir?: string,
	slDir?: string,
	configuredFileContentRoots: string[] = [],
	jbDir?: string,
	registryDir?: string,
	mirrorDir?: string,
): Promise<RecursiveWatcher> {
	// The recursive watcher reports real paths, so every directory compared
	// against an event path is canonicalized once here (`~/.claude` may be a symlink).
	if (projDir) {
		resolveProjectsDirectory(projDir);
		projectsDir = canonicalPath(projDir);
	}
	if (plDir) plansDir = canonicalPath(plDir);
	if (slDir) statuslineDir = canonicalPath(slDir);
	if (jbDir) jobsDir = canonicalPath(jbDir);
	if (registryDir) sessionRegistryDirs = new Set([resolve(registryDir), canonicalPath(registryDir)]);
	if (mirrorDir) contextMirrorDir = canonicalPath(mirrorDir);
	setFileContentRoots(configuredFileContentRoots);

	await Promise.all(
		fileContentRoots.map(async (root) => {
			try {
				await trackedFileIndex.refresh(root);
			} catch {
				// A later Git index event or startup scan retries transient discovery failures.
			}
		}),
	);

	// Re-resolve ignored directories at boot so config edits take effect on restart.
	ignoredDirPattern = buildIgnoredDirPattern(resolveIgnoredDirNames());

	if (watcher) await watcher.close();

	const watchedRoots = [...new Set([...dirs, ...fileContentRoots])];
	for (const indexPath of fileContentRootByGitIndexPath.keys()) {
		const indexDirectory = dirname(indexPath);
		if (!isPathInsideFileContentRoots(indexDirectory, watchedRoots)) watchedRoots.push(indexDirectory);
	}

	watcher = createRecursiveWatcher(watchedRoots, shouldIgnoreWatch);

	watcher.on("add", onFileChange);
	watcher.on("change", onFileChange);
	watcher.on("unlink", onFileUnlink);

	return watcher;
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export const __testing = {
	toSessionSummaryPayload,
	sessionSummariesEqual,
	toTaskSummaryPayload,
	tasksEqual,
	handleJsonlPlanLinks,
	handlePlanMdChange,
	handlePlanMdUnlink,
	handleFileContentChange,
	handleFileContentUnlink,
	handleFileChange,
	handleFileUnlink,
	/** Resolve once every indexing job handleFileChange detached, including ones started meanwhile, has finished. */
	async settleDetachedWork(): Promise<void> {
		while (detachedWork.size > 0) await Promise.allSettled(detachedWork);
	},
	handleJobFileEvent,
	handleWorkflowFileEvent,
	resetWorkflowThrottle,
	readIgnoredDirsFromConfig,
	DEFAULT_IGNORED_DIR_NAMES,
	/** Override the resolved ignored-dir pattern so `shouldIgnoreWatch` is deterministic in tests. */
	setIgnoredDirPattern(pattern: RegExp): void {
		ignoredDirPattern = pattern;
	},
	/** Restore the pattern derived purely from the hard-coded defaults. */
	resetIgnoredDirPattern(): void {
		ignoredDirPattern = buildIgnoredDirPattern(new Set(DEFAULT_IGNORED_DIR_NAMES));
	},
	setProjectsDir(dir: string): void {
		projectsDir = dir;
	},
	setFileContentRoots(roots: string[]): void {
		setFileContentRoots(roots);
	},
	resetJsonlThrottle(): void {
		for (const state of jsonlThrottleByPath.values()) {
			if (state.timer !== undefined) clearTimeout(state.timer);
		}
		jsonlThrottleByPath.clear();
		jsonlExpediteUntilBySession.clear();
		sharedJsonlOffsets.clear();
	},
};
