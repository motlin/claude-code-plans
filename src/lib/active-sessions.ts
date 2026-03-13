import {readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';

export interface ActiveSession {
	sessionId: string;
	projectDir: string;
	lastModified: number;
}

const ACTIVE_THRESHOLD_MS = 60_000;

export function getActiveSessions(): ActiveSession[] {
	const projectsDir = join(homedir(), '.claude', 'projects');
	const now = Date.now();
	const active: ActiveSession[] = [];

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
	return active;
}
