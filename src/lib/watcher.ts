import {watch} from 'chokidar';
import type {FSWatcher} from 'chokidar';
import {stat} from 'node:fs/promises';
import {basename, dirname} from 'node:path';
import {getDb} from './db';
import {indexFile} from './db/indexer';
import {listSessionsForProjectFromDb, getTasksForProject} from './db/queries';
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

// Persist mutable state on globalThis so it survives Vite HMR reloads.
// Without this, each reload creates fresh module-scoped variables while the
// old watcher, timers, and SSE clients leak in the previous module closure.
interface WatcherGlobals {
	__watcherClients: Set<ReadableStreamDefaultController>;
	__watcher: FSWatcher | null;
	__watcherProjectsDir: string;
	__watcherPlansDir: string;
	__watcherStatuslineDir: string;
	__jsonlDebounceTimer: ReturnType<typeof setTimeout> | null;
	__lastSessionsByProject: Map<string, Map<string, SessionSummaryPayload>>;
	__lastTasksByProject: Map<string, Map<string, TaskSummaryPayload>>;
}

const g = globalThis as unknown as Partial<WatcherGlobals>;
if (!g.__watcherClients) g.__watcherClients = new Set();
if (!g.__lastSessionsByProject) g.__lastSessionsByProject = new Map();
if (!g.__lastTasksByProject) g.__lastTasksByProject = new Map();

const encoder = new TextEncoder();

const WATCHED_EXTENSIONS = new Set(['.md', '.jsonl', '.json']);
const JSONL_DEBOUNCE_MS = 5000;

export function broadcastTyped(type: string, data: Record<string, unknown>): void {
	const payload = encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
	for (const client of g.__watcherClients!) {
		try {
			client.enqueue(payload);
		} catch {
			g.__watcherClients!.delete(client);
		}
	}
}

export function broadcast(): void {
	broadcastTyped(SSE_EVENTS.CONTENT_UPDATED, {});
}

export function addClient(controller: ReadableStreamDefaultController): void {
	g.__watcherClients!.add(controller);
}

export function removeClient(controller: ReadableStreamDefaultController): void {
	g.__watcherClients!.delete(controller);
}

export function getClientCount(): number {
	return g.__watcherClients!.size;
}

function sessionSummariesEqual(a: SessionSummaryPayload, b: SessionSummaryPayload): boolean {
	return (
		a.id === b.id &&
		a.title === b.title &&
		a.summary === b.summary &&
		a.mtime === b.mtime &&
		a.messageCount === b.messageCount &&
		a.gitBranch === b.gitBranch &&
		a.projectName === b.projectName
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
	const next = new Map<string, SessionSummaryPayload>();
	for (const row of rows) {
		next.set(row.id, toSessionSummaryPayload(row));
	}

	const previous = g.__lastSessionsByProject!.get(projectId) ?? new Map();
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

	g.__lastSessionsByProject!.set(projectId, next);
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

	const previous = g.__lastTasksByProject!.get(projectDir) ?? new Map();
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

	g.__lastTasksByProject!.set(projectDir, next);
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

	const projectsDir = g.__watcherProjectsDir ?? '';
	const plansDir = g.__watcherPlansDir ?? '';

	if (ext === '.jsonl') {
		if (g.__jsonlDebounceTimer) clearTimeout(g.__jsonlDebounceTimer);
		g.__jsonlDebounceTimer = setTimeout(async () => {
			await indexSilently(path, projectsDir);
			safeDiffSessions(projectIdFromPath(path, projectsDir));
			g.__jsonlDebounceTimer = null;
		}, JSONL_DEBOUNCE_MS);
	} else if (ext === '.json' && g.__watcherStatuslineDir && path.startsWith(g.__watcherStatuslineDir)) {
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

	const projectsDir = g.__watcherProjectsDir ?? '';
	const plansDir = g.__watcherPlansDir ?? '';

	if (ext === '.md' && plansDir && path.startsWith(plansDir)) {
		broadcastTyped(DOMAIN_EVENTS.PLAN_REMOVED, {filename: basename(path)});
	} else if (ext === '.jsonl') {
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
	if (projDir) g.__watcherProjectsDir = projDir;
	if (plDir) g.__watcherPlansDir = plDir;
	if (slDir) g.__watcherStatuslineDir = slDir;

	// Close previous watcher on HMR reload
	if (g.__watcher) {
		await g.__watcher.close();
	}

	g.__watcher = watch(dirs, {
		ignoreInitial: true,
		awaitWriteFinish: {stabilityThreshold: 300, pollInterval: 100},
		usePolling: true,
		interval: 1000,
	});

	g.__watcher.on('add', handleFileChange);
	g.__watcher.on('change', handleFileChange);
	g.__watcher.on('unlink', handleFileUnlink);

	return g.__watcher;
}

export async function closeWatcher(): Promise<void> {
	if (g.__watcher) {
		await g.__watcher.close();
		g.__watcher = null;
	}
	if (g.__jsonlDebounceTimer) {
		clearTimeout(g.__jsonlDebounceTimer);
		g.__jsonlDebounceTimer = null;
	}
	for (const client of g.__watcherClients!) {
		try {
			client.close();
		} catch {
			// already closed
		}
	}
	g.__watcherClients!.clear();
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
