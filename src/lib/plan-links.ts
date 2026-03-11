import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {stat} from 'node:fs/promises';
import {resolveProjectName} from './memory';
import {FileHistorySnapshotSchema} from './schemas';

export interface PlanSessionLink {
	planFilename: string;
	sessionId: string;
	project: string;
	projectName: string;
}

const PLAN_PATH_RE = /\.claude\/plans\/([^/]+\.md)$/;

let cachedLinks: PlanSessionLink[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000;

export async function scanPlanLinks(projectsDir: string): Promise<PlanSessionLink[]> {
	const now = Date.now();
	if (cachedLinks && now - cacheTime < CACHE_TTL) {
		return cachedLinks;
	}

	let projectDirs: string[];
	try {
		projectDirs = await readdir(projectsDir);
	} catch {
		return [];
	}

	const links: PlanSessionLink[] = [];

	for (const project of projectDirs) {
		const projectPath = join(projectsDir, project);
		let files: string[];
		try {
			const dirStat = await stat(projectPath);
			if (!dirStat.isDirectory()) continue;
			files = await readdir(projectPath);
		} catch {
			continue;
		}

		const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
		const projectName = await resolveProjectName(project);

		for (const file of jsonlFiles) {
			const sessionId = file.replace(/\.jsonl$/, '');
			const filePath = join(projectPath, file);

			try {
				const content = await readFile(filePath, 'utf-8');
				const planFilenames = new Set<string>();

				for (const line of content.split('\n')) {
					if (!line.includes('file-history-snapshot')) continue;

					let parsed: unknown;
					try {
						parsed = JSON.parse(line);
					} catch {
						continue;
					}

					const result = FileHistorySnapshotSchema.safeParse(parsed);
					if (!result.success) continue;

					for (const key of Object.keys(result.data.snapshot.trackedFileBackups)) {
						const match = PLAN_PATH_RE.exec(key);
						if (match?.[1]) {
							planFilenames.add(match[1]);
						}
					}
				}

				for (const planFilename of planFilenames) {
					links.push({planFilename, sessionId, project, projectName});
				}
			} catch {
				// skip unreadable files
			}
		}
	}

	cachedLinks = links;
	cacheTime = now;
	return links;
}

export async function scanPlanLinksForProject(projectsDir: string, project: string): Promise<PlanSessionLink[]> {
	const projectPath = join(projectsDir, project);
	let files: string[];
	try {
		const dirStat = await stat(projectPath);
		if (!dirStat.isDirectory()) return [];
		files = await readdir(projectPath);
	} catch {
		return [];
	}

	const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
	if (jsonlFiles.length === 0) return [];

	const projectName = await resolveProjectName(project);
	const links: PlanSessionLink[] = [];

	for (const file of jsonlFiles) {
		const sessionId = file.replace(/\.jsonl$/, '');
		const filePath = join(projectPath, file);

		try {
			const content = await readFile(filePath, 'utf-8');
			const planFilenames = new Set<string>();

			for (const line of content.split('\n')) {
				if (!line.includes('file-history-snapshot')) continue;

				let parsed: unknown;
				try {
					parsed = JSON.parse(line);
				} catch {
					continue;
				}

				const result = FileHistorySnapshotSchema.safeParse(parsed);
				if (!result.success) continue;

				for (const key of Object.keys(result.data.snapshot.trackedFileBackups)) {
					const match = PLAN_PATH_RE.exec(key);
					if (match?.[1]) {
						planFilenames.add(match[1]);
					}
				}
			}

			for (const planFilename of planFilenames) {
				links.push({planFilename, sessionId, project, projectName});
			}
		} catch {
			// skip unreadable files
		}
	}

	return links;
}

export function invalidatePlanLinksCache(): void {
	cachedLinks = null;
	cacheTime = 0;
}
