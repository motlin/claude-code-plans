import {watch} from 'chokidar';
import type {FSWatcher} from 'chokidar';
import {stat} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {eq} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {awaitInitialScan, getDb} from './db';
import {indexFile, deletePlan} from './db/indexer';
import {listSessionsForProjectFromDb, getTasksForProject, getStarredSessionIds} from './db/queries';
import type {TaskRow} from './db/queries';
import {updatePendingApprovalForSession, removePendingApprovalForSession} from './db/pending-approvals-cache';
import * as dbSchema from './db/schema';
import {extractTitle} from './markdown-utils';
import {resolveProjectName} from './memory';
import {
	DOMAIN_EVENTS,
	SSE_EVENTS,
	diffEntityMaps,
	type SessionSummaryPayload,
	type TaskSummaryPayload,
} from './hook-events';

type IndexDb = BetterSQLite3Database<typeof dbSchema>;

/** Callback signature for broadcasting events. */
type BroadcastFn = (type: string, data: Record<string, unknown>) => void;
import {toSessionSummaryPayload} from './session-summary';
import {hmrPersist, hmrDispose} from './hmr-persist';
import {broadcastTyped, broadcast, addClient, removeClient} from './sse-broadcast';
import {recentlyBroadcast} from './update-dedupe';

/**
 * TTL covering the gap between the hook fast-path broadcast and this
 * trailing chokidar broadcast. Mirrors `DEDUPE_TTL_MS` in
 * `src/lib/hook-dispatcher.ts`.
 */
const DEDUPE_TTL_MS = 500;

export {broadcastTyped, broadcast, addClient, removeClient};

// Persisted state: survives HMR reloads via import.meta.hot.data
const lastSessionsByProject = hmrPersist(
	'lastSessionsByProject',
	() => new Map<string, Map<string, SessionSummaryPayload>>(),
);
const lastTasksByProject = hmrPersist('lastTasksByProject', () => new Map<string, Map<string, TaskSummaryPayload>>());
const jsonlOffsets = hmrPersist('jsonlOffsets', () => new Map<string, number>());

// Transient state: module-scoped, recreated on HMR
let watcher: FSWatcher | null = null;
let projectsDir = '';
let plansDir = '';
let statuslineDir = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastFired = 0;

hmrDispose(async () => {
	if (watcher) await watcher.close();
	if (debounceTimer) clearTimeout(debounceTimer);
});

const WATCHED_EXTENSIONS = new Set(['.md', '.jsonl', '.json']);
const JSONL_THROTTLE_MS = 2000;

function sessionSummariesEqual(a: SessionSummaryPayload, b: SessionSummaryPayload): boolean {
	return (
		a.id === b.id &&
		a.title === b.title &&
		a.summary === b.summary &&
		a.mtime === b.mtime &&
		a.messageCount === b.messageCount &&
		a.gitBranch === b.gitBranch &&
		a.projectName === b.projectName &&
		a.starred === b.starred
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
		JSON.stringify(a.blocks) === JSON.stringify(b.blocks) &&
		JSON.stringify(a.blockedBy) === JSON.stringify(b.blockedBy)
	);
}

/**
 * Diff the current DB sessions for a project against the last-known snapshot
 * and broadcast domain-level session:added / session:removed / session:updated
 * events for each delta.
 */
function diffAndBroadcastSessions(projectId: string): void {
	const {index} = getDb();
	const rows = listSessionsForProjectFromDb(index, projectId);
	const starredIds = getStarredSessionIds(index);
	const next = new Map<string, SessionSummaryPayload>();
	for (const row of rows) {
		next.set(row.id, toSessionSummaryPayload(row, starredIds.has(row.id)));
	}

	const previous = lastSessionsByProject.get(projectId) ?? new Map();
	const {added, removed, updated} = diffEntityMaps(previous, next, sessionSummariesEqual);

	for (const session of added) {
		const key = `${DOMAIN_EVENTS.SESSION_ADDED}:${session.id}:${session.mtime}`;
		if (recentlyBroadcast(key, DEDUPE_TTL_MS)) continue;
		broadcastTyped(DOMAIN_EVENTS.SESSION_ADDED, {session});
	}
	for (const sessionId of removed) {
		const key = `${DOMAIN_EVENTS.SESSION_REMOVED}:${sessionId}:${projectId}`;
		if (recentlyBroadcast(key, DEDUPE_TTL_MS)) continue;
		broadcastTyped(DOMAIN_EVENTS.SESSION_REMOVED, {sessionId, projectDir: projectId});
	}
	for (const session of updated) {
		const key = `${DOMAIN_EVENTS.SESSION_UPDATED}:${session.id}:${session.mtime}`;
		if (recentlyBroadcast(key, DEDUPE_TTL_MS)) continue;
		broadcastTyped(DOMAIN_EVENTS.SESSION_UPDATED, {session});
	}

	lastSessionsByProject.set(projectId, next);
}

/**
 * Diff the current DB tasks for a project against the last-known snapshot
 * and broadcast task:changed / task:completed deltas. A task transitioning to
 * status 'completed' gets a task:completed event in addition to task:changed.
 */
function diffAndBroadcastTasks(projectDir: string): void {
	const {index} = getDb();
	const rows = getTasksForProject(index, projectDir);
	const next = new Map<string, TaskSummaryPayload>();
	for (const row of rows) {
		next.set(row.taskId, toTaskSummaryPayload(row));
	}

	const previous = lastTasksByProject.get(projectDir) ?? new Map();
	const {added, removed, updated} = diffEntityMaps(previous, next, tasksEqual);

	for (const task of added) {
		const key = `${DOMAIN_EVENTS.TASK_CHANGED}:${task.taskId}:${task.status}`;
		if (!recentlyBroadcast(key, DEDUPE_TTL_MS)) {
			broadcastTyped(DOMAIN_EVENTS.TASK_CHANGED, {task});
		}
		if (task.status === 'completed') {
			broadcastTyped(DOMAIN_EVENTS.TASK_COMPLETED, {taskId: task.taskId, subject: task.subject});
		}
	}
	for (const task of updated) {
		const key = `${DOMAIN_EVENTS.TASK_CHANGED}:${task.taskId}:${task.status}`;
		if (!recentlyBroadcast(key, DEDUPE_TTL_MS)) {
			broadcastTyped(DOMAIN_EVENTS.TASK_CHANGED, {task});
		}
		const wasCompleted = previous.get(task.taskId)?.status === 'completed';
		if (task.status === 'completed' && !wasCompleted) {
			broadcastTyped(DOMAIN_EVENTS.TASK_COMPLETED, {taskId: task.taskId, subject: task.subject});
		}
	}
	// Removed tasks: file was deleted. No explicit removal delta is defined yet;
	// clients can invalidate the tasks query if needed via task:changed elsewhere.
	for (const taskId of removed) {
		// Intentionally no broadcast — schema does not define task:removed yet.
		void taskId;
	}

	lastTasksByProject.set(projectDir, next);
}

/**
 * Broadcast a plan:changed event with the plan's filename, title, and mtime.
 * Falls through silently if the file has since disappeared. Accepts an
 * injectable broadcast callback so tests can capture emissions.
 */
async function broadcastPlanChangedWith(filePath: string, broadcast: BroadcastFn): Promise<void> {
	const filename = basename(filePath);
	let mtime: Date;
	try {
		const fileStat = await stat(filePath);
		mtime = fileStat.mtime;
	} catch {
		return;
	}
	const key = `${DOMAIN_EVENTS.PLAN_CHANGED}:${filename}:${mtime.toISOString()}`;
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
	try {
		const fileStat = await stat(filePath);
		mtime = fileStat.mtime;
	} catch {
		return;
	}
	const relative = filePath.slice(projectsDir.length + 1);
	const project = relative.split('/')[0] ?? '';
	if (!project) return;
	const key = `${DOMAIN_EVENTS.MEMORY_CHANGED}:${filePath}:${mtime.toISOString()}`;
	if (recentlyBroadcast(key, DEDUPE_TTL_MS)) return;
	const projectName = await resolveProjectName(project);
	const title = filename.replace(/\.md$/, '');
	broadcastTyped(DOMAIN_EVENTS.MEMORY_CHANGED, {
		memory: {filename, title, mtime: mtime.toISOString(), project, projectName},
	});
}

/** Safely diff and broadcast sessions for a project; swallow indexing races. */
function safeDiffSessions(projectId: string): void {
	if (!projectId) return;
	try {
		diffAndBroadcastSessions(projectId);
	} catch {
		// transient DB error; next file event will retry
	}
}

/** Safely diff and broadcast tasks for a project; swallow indexing races. */
function safeDiffTasks(projectDir: string): void {
	if (!projectDir) return;
	try {
		diffAndBroadcastTasks(projectDir);
	} catch {
		// transient DB error; next file event will retry
	}
}

/** Extract the first path segment under projectsDir, or '' if path is outside it. */
function projectIdFromPath(path: string, projectsDir: string): string {
	if (!projectsDir || !path.startsWith(projectsDir)) return '';
	const relative = path.slice(projectsDir.length + 1);
	return relative.split('/')[0] ?? '';
}

/** Extract session ID from a JSONL file path (filename minus .jsonl extension). */
function sessionIdFromJsonlPath(path: string): string {
	return basename(path, '.jsonl');
}

async function indexSilently(path: string, projectsDir: string): Promise<{linkedPlans: string[]}> {
	try {
		const {index} = getDb();
		return await indexFile(index, path, projectsDir, plansDir || undefined);
	} catch {
		// indexing error — deltas below still reflect prior DB state
		return {linkedPlans: []};
	}
}

async function handleFileChange(path: string): Promise<void> {
	await awaitInitialScan();
	const ext = path.slice(path.lastIndexOf('.'));
	if (!WATCHED_EXTENSIONS.has(ext)) return;

	if (ext === '.jsonl') {
		// Throttle: fire immediately on the first change, then at most once
		// per JSONL_THROTTLE_MS. A trailing timer ensures the final batch of
		// changes is always processed even after writes stop.
		const now = Date.now();
		const elapsed = now - lastFired;

		const fire = async () => {
			lastFired = Date.now();
			debounceTimer = null;

			const fromOffset = jsonlOffsets.get(path) ?? 0;
			try {
				const {readNewJsonlLines} = await import('./sessions');
				const {lines: newLines, nextByteOffset} = await readNewJsonlLines(path, fromOffset);
				jsonlOffsets.set(path, nextByteOffset);

				if (newLines.length > 0) {
					const sessionId = sessionIdFromJsonlPath(path);
					const key = `${DOMAIN_EVENTS.SESSION_LINES_APPENDED}:${sessionId}:${nextByteOffset}`;
					if (!recentlyBroadcast(key, DEDUPE_TTL_MS)) {
						broadcastTyped(DOMAIN_EVENTS.SESSION_LINES_APPENDED, {
							sessionId,
							lines: newLines,
						});
					}
				}
			} catch {
				// File may have been deleted between the watcher event and this read.
			}

			const {linkedPlans} = await indexSilently(path, projectsDir);
			const projectId = projectIdFromPath(path, projectsDir);
			safeDiffSessions(projectId);
			if (plansDir) {
				for (const planFilename of linkedPlans) {
					void broadcastPlanChanged(join(plansDir, planFilename));
				}
			}

			if (projectId) {
				try {
					const projectName = await resolveProjectName(projectId);
					await updatePendingApprovalForSession(
						getDb().index,
						sessionIdFromJsonlPath(path),
						path,
						projectId,
						projectName,
					);
				} catch {
					// transient error scanning JSONL; next change will retry
				}
			}
		};

		if (debounceTimer) clearTimeout(debounceTimer);

		if (elapsed >= JSONL_THROTTLE_MS) {
			// Enough time has passed -- fire immediately.
			void fire();
		} else {
			// Schedule a trailing fire for the remaining interval.
			debounceTimer = setTimeout(() => void fire(), JSONL_THROTTLE_MS - elapsed);
		}
	} else if (ext === '.json' && statuslineDir && path.startsWith(statuslineDir)) {
		const filename = basename(path);
		const sessionId = filename.replace(/\.json$/, '');
		broadcastTyped(SSE_EVENTS.STATUSLINE_UPDATED, {sessionId});
	} else if (ext === '.json' && path.includes('/tasks/')) {
		(async () => {
			await indexSilently(path, projectsDir);
			// ~/.claude/tasks/{projectDir}/{taskId}.json
			safeDiffTasks(basename(dirname(path)));
		})();
	} else if (ext === '.json' && path.endsWith('sessions-index.json')) {
		(async () => {
			await indexSilently(path, projectsDir);
			safeDiffSessions(basename(dirname(path)));
		})();
	} else if (ext === '.md') {
		if (plansDir && path.startsWith(plansDir)) {
			(async () => {
				try {
					await handlePlanMdChange(getDb().index, path, projectsDir, plansDir, broadcastTyped);
				} catch {
					// transient indexing error
					await broadcastPlanChanged(path);
				}
			})();
		} else if (projectsDir && path.startsWith(projectsDir)) {
			(async () => {
				await indexSilently(path, projectsDir);
				await broadcastMemoryChanged(path, projectsDir);
			})();
		}
	}
}

async function handleFileUnlink(path: string): Promise<void> {
	await awaitInitialScan();
	const ext = path.slice(path.lastIndexOf('.'));
	if (!WATCHED_EXTENSIONS.has(ext)) return;

	if (ext === '.md' && plansDir && path.startsWith(plansDir)) {
		try {
			handlePlanMdUnlink(getDb().index, path, broadcastTyped);
		} catch {
			// transient DB error; ensure broadcast still fires
			broadcastTyped(DOMAIN_EVENTS.PLAN_REMOVED, {filename: basename(path)});
		}
	} else if (ext === '.md' && projectsDir && path.startsWith(projectsDir)) {
		const relative = path.slice(projectsDir.length + 1);
		const project = relative.split('/')[0] ?? '';
		if (project) {
			try {
				const {index} = getDb();
				index.delete(dbSchema.memories).where(eq(dbSchema.memories.filePath, path)).run();
				index.delete(dbSchema.indexedFiles).where(eq(dbSchema.indexedFiles.path, path)).run();
			} catch {
				// transient DB error; broadcast still fires
			}
			broadcastTyped(DOMAIN_EVENTS.MEMORY_REMOVED, {project, filename: basename(path)});
		}
	} else if (ext === '.jsonl') {
		jsonlOffsets.delete(path);
		safeDiffSessions(projectIdFromPath(path, projectsDir));
		removePendingApprovalForSession(sessionIdFromJsonlPath(path));
	} else if (ext === '.json' && path.endsWith('sessions-index.json')) {
		safeDiffSessions(basename(dirname(path)));
	} else if (ext === '.json' && path.includes('/tasks/')) {
		safeDiffTasks(basename(dirname(path)));
	}
}

export async function createWatcher(
	dirs: string[],
	projDir?: string,
	plDir?: string,
	slDir?: string,
): Promise<FSWatcher> {
	if (projDir) projectsDir = projDir;
	if (plDir) plansDir = plDir;
	if (slDir) statuslineDir = slDir;

	if (watcher) await watcher.close();

	watcher = watch(dirs, {
		ignoreInitial: true,
		awaitWriteFinish: {stabilityThreshold: 300, pollInterval: 100},
	});

	watcher.on('add', handleFileChange);
	watcher.on('change', handleFileChange);
	watcher.on('unlink', handleFileUnlink);

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
};
