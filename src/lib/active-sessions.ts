import {readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {resolveProjectName} from './memory';

export interface ActiveSession {
	sessionId: string;
	projectDir: string;
	projectName: string;
	lastModified: number;
}

const ACTIVE_THRESHOLD_MS = 60_000;

export async function getActiveSessions(): Promise<ActiveSession[]> {
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
				if (now - st.mtimeMs < ACTIVE_THRESHOLD_MS) {
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
