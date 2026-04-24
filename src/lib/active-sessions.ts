import {readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {resolveProjectName} from './memory';
import {getActiveSessionEntries} from './active-session-store';

export interface ActiveSession {
	sessionId: string;
	projectDir: string;
	projectName: string;
	lastModified: number;
}

const DEFAULT_ACTIVE_THRESHOLD_MS = 60_000;

export async function getActiveSessions(activeTimeoutMs = DEFAULT_ACTIVE_THRESHOLD_MS): Promise<ActiveSession[]> {
	// Check in-memory store first (populated by hook events)
	const storeEntries = getActiveSessionEntries();
	if (storeEntries.length > 0) {
		return getActiveSessionsFromStore(storeEntries);
	}

	// Fallback to filesystem scan when hooks are not configured
	return getActiveSessionsFromFilesystem(activeTimeoutMs);
}

async function getActiveSessionsFromStore(
	entries: ReturnType<typeof getActiveSessionEntries>,
): Promise<ActiveSession[]> {
	const sorted = [...entries].sort((a, b) => b.lastActivity - a.lastActivity);
	const nameCache = new Map<string, string>();
	const result: ActiveSession[] = [];

	for (const entry of sorted) {
		// Resolve project dir from cwd — look for matching project dirs
		const projectDir = await findProjectDirForCwd(entry.cwd);
		if (!projectDir) continue;

		let name = nameCache.get(projectDir);
		if (!name) {
			name = await resolveProjectName(projectDir);
			nameCache.set(projectDir, name);
		}
		result.push({
			sessionId: entry.sessionId,
			projectDir,
			projectName: name,
			lastModified: entry.lastActivity,
		});
	}
	return result;
}

async function findProjectDirForCwd(cwd: string): Promise<string | null> {
	if (!cwd) return null;
	const projectsDir = join(homedir(), '.claude', 'projects');
	let dirs: string[];
	try {
		dirs = readdirSync(projectsDir);
	} catch {
		return null;
	}
	// The project dir name is an encoded form of the cwd path
	// Try to find a dir whose decoded name matches the cwd
	for (const dir of dirs) {
		const decoded = await resolveProjectName(dir);
		if (decoded === cwd || cwd.endsWith(decoded)) return dir;
	}
	return null;
}

async function getActiveSessionsFromFilesystem(activeThresholdMs: number): Promise<ActiveSession[]> {
	const projectsDir = join(homedir(), '.claude', 'projects');
	const now = Date.now();
	const active: Array<Omit<ActiveSession, 'projectName'> & {projectDir: string}> = [];

	let projectDirs: string[];
	try {
		projectDirs = readdirSync(projectsDir);
	} catch {
		return [];
	}

	for (const dir of projectDirs) {
		const projectPath = join(projectsDir, dir);
		let files: string[];
		try {
			files = readdirSync(projectPath);
		} catch {
			continue;
		}

		for (const file of files) {
			if (!file.endsWith('.jsonl')) continue;
			const filePath = join(projectPath, file);
			try {
				const st = statSync(filePath);
				if (now - st.mtimeMs < activeThresholdMs) {
					active.push({
						sessionId: file.replace(/\.jsonl$/, ''),
						projectDir: dir,
						lastModified: st.mtimeMs,
					});
				}
			} catch {
				continue;
			}
		}
	}

	active.sort((a, b) => b.lastModified - a.lastModified);

	const nameCache = new Map<string, string>();
	const result: ActiveSession[] = [];
	for (const s of active) {
		let name = nameCache.get(s.projectDir);
		if (!name) {
			name = await resolveProjectName(s.projectDir);
			nameCache.set(s.projectDir, name);
		}
		result.push({...s, projectName: name});
	}
	return result;
}
