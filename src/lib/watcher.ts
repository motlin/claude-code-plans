import {watch} from 'chokidar';
import type {FSWatcher} from 'chokidar';
import {stat} from 'node:fs/promises';
import {basename, dirname} from 'node:path';
import {getDb} from './db';
import {indexFile} from './db/indexer';
import {listSessionsForProjectFromDb, getTasksForProject, getStarredSessionIds} from './db/queries';
import type {TaskRow} from './db/queries';
import {extractTitle} from './markdown-utils';
import {resolveProjectName} from './memory';
import {
	DOMAIN_EVENTS,
	SSE_EVENTS,
	diffEntityMaps,
	type SessionSummaryPayload,
	type TaskSummaryPayload,
} from './hook-events';
import {toSessionSummaryPayload} from './session-summary';
import {hmrPersist, hmrDispose} from './hmr-persist';

// Persisted state: survives HMR reloads via import.meta.hot.data
const clients = hmrPersist('watcherClients', () => new Set<ReadableStreamDefaultController>());
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

const encoder = new TextEncoder();

const WATCHED_EXTENSIONS = new Set(['.md', '.jsonl', '.json']);
const JSONL_THROTTLE_MS = 2000;

export function broadcastTyped(type: string, data: Record<string, unknown>): void {
	const payload = encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
	for (const client of clients) {
		try {
			client.enqueue(payload);
		} catch {
			clients.delete(client);
		}
	}
}

export function broadcast(): void {
	broadcastTyped(SSE_EVENTS.CONTENT_UPDATED, {});
}

export function addClient(controller: ReadableStreamDefaultController): void {
	clients.add(controller);
}

export function removeClient(controller: ReadableStreamDefaultController): void {
	clients.delete(controller);
}

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
		broadcastTyped(DOMAIN_EVENTS.SESSION_ADDED, {session});
	}
	for (const sessionId of removed) {
		broadcastTyped(DOMAIN_EVENTS.SESSION_REMOVED, {sessionId, projectDir: projectId});
	}
	for (const session of updated) {
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
		broadcastTyped(DOMAIN_EVENTS.TASK_CHANGED, {task});
		if (task.status === 'completed') {
			broadcastTyped(DOMAIN_EVENTS.TASK_COMPLETED, {taskId: task.taskId, subject: task.subject});
		}
	}
	for (const task of updated) {
		broadcastTyped(DOMAIN_EVENTS.TASK_CHANGED, {task});
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
 * Falls through silently if the file has since disappeared.
 */
async function broadcastPlanChanged(filePath: string): Promise<void> {
	const filename = basename(filePath);
	let mtime: Date;
	try {
		const fileStat = await stat(filePath);
		mtime = fileStat.mtime;
	} catch {
		return;
	}
	const title = await extractTitle(filePath, filename);
	broadcastTyped(DOMAIN_EVENTS.PLAN_CHANGED, {
		plan: {filename, title, mtime: mtime.toISOString()},
	});
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

async function indexSilently(path: string, projectsDir: string): Promise<void> {
	try {
		const {index} = getDb();
		await indexFile(index, path, projectsDir);
	} catch {
		// indexing error — deltas below still reflect prior DB state
	}
}

function handleFileChange(path: string): void {
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
					broadcastTyped(DOMAIN_EVENTS.SESSION_LINES_APPENDED, {
						sessionId: sessionIdFromJsonlPath(path),
						lines: newLines,
					});
				}
			} catch {
				// File may have been deleted between the watcher event and this read.
			}

			await indexSilently(path, projectsDir);
			safeDiffSessions(projectIdFromPath(path, projectsDir));
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
			void broadcastPlanChanged(path);
		} else if (projectsDir && path.startsWith(projectsDir)) {
			void broadcastMemoryChanged(path, projectsDir);
		}
	}
}

function handleFileUnlink(path: string): void {
	const ext = path.slice(path.lastIndexOf('.'));
	if (!WATCHED_EXTENSIONS.has(ext)) return;

	if (ext === '.md' && plansDir && path.startsWith(plansDir)) {
		broadcastTyped(DOMAIN_EVENTS.PLAN_REMOVED, {filename: basename(path)});
	} else if (ext === '.md' && projectsDir && path.startsWith(projectsDir)) {
		const relative = path.slice(projectsDir.length + 1);
		const project = relative.split('/')[0] ?? '';
		if (project) {
			broadcastTyped(DOMAIN_EVENTS.MEMORY_REMOVED, {project, filename: basename(path)});
		}
	} else if (ext === '.jsonl') {
		jsonlOffsets.delete(path);
		safeDiffSessions(projectIdFromPath(path, projectsDir));
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
		usePolling: true,
		interval: 1000,
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
};
