import {readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {resolveProjectName, type MemoryEntry} from './memory';
import {listSessions, listSessionsForProject, listSessionsFromJsonl, type SessionEntry} from './sessions';
import {scanPlanLinksForProject, type PlanSessionLink} from './plan-links';

export interface ProjectSummary {
	id: string;
	name: string;
	projectPath?: string | undefined;
	sessionCount: number;
	memoryCount: number;
	lastActivity: Date;
	gitBranch?: string | undefined;
}

export interface ProjectDetail {
	id: string;
	name: string;
	projectPath?: string | undefined;
	sessions: SessionEntry[];
	memories: MemoryEntry[];
	plans: PlanSessionLink[];
}

async function countMemories(projectsDir: string, project: string): Promise<number> {
	const memDir = join(projectsDir, project, 'memory');
	try {
		const files = await readdir(memDir);
		return files.filter((f) => f.endsWith('.md')).length;
	} catch {
		return 0;
	}
}

async function readMemoryEntries(projectsDir: string, project: string): Promise<MemoryEntry[]> {
	const memDir = join(projectsDir, project, 'memory');
	let files: string[];
	try {
		files = await readdir(memDir);
	} catch {
		return [];
	}

	const mdFiles = files.filter((f) => f.endsWith('.md'));
	const projectName = await resolveProjectName(project);
	const entries: MemoryEntry[] = [];

	for (const filename of mdFiles) {
		try {
			const fileStat = await stat(join(memDir, filename));
			entries.push({
				filename,
				title: filename.replace(/\.md$/, ''),
				mtime: fileStat.mtime,
				project,
				projectName,
			});
		} catch {
			// skip
		}
	}

	entries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
	return entries;
}

export async function listProjects(projectsDir: string): Promise<ProjectSummary[]> {
	let projectDirs: string[];
	try {
		projectDirs = await readdir(projectsDir);
	} catch {
		return [];
	}

	const sessionGroups = await listSessions(projectsDir);
	const sessionsByProject = new Map(sessionGroups.map((g) => [g.project, g.sessions]));

	const projects: ProjectSummary[] = [];

	for (const project of projectDirs) {
		const projectPath = join(projectsDir, project);
		try {
			const dirStat = await stat(projectPath);
			if (!dirStat.isDirectory()) continue;
		} catch {
			continue;
		}

		const sessions = sessionsByProject.get(project) ?? [];
		const memoryCount = await countMemories(projectsDir, project);

		if (sessions.length === 0 && memoryCount === 0) continue;

		const lastActivity =
			sessions.length > 0 ? new Date(Math.max(...sessions.map((s) => s.mtime.getTime()))) : new Date(0);

		const latestSession = sessions[0];

		projects.push({
			id: project,
			name: latestSession?.projectName ?? (await resolveProjectName(project)),
			projectPath: latestSession?.projectPath,
			sessionCount: sessions.length,
			memoryCount,
			lastActivity,
			gitBranch: latestSession?.gitBranch,
		});
	}

	projects.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
	return projects;
}

export async function getProjectDetail(projectsDir: string, projectId: string): Promise<ProjectDetail | null> {
	if (projectId.includes('..')) return null;

	const projectPath = join(projectsDir, projectId);
	try {
		const dirStat = await stat(projectPath);
		if (!dirStat.isDirectory()) return null;
	} catch {
		return null;
	}

	let sessions = await listSessionsForProject(projectsDir, projectId);
	if (!sessions) {
		sessions = await listSessionsFromJsonl(projectsDir, projectId);
	}
	sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

	const memories = await readMemoryEntries(projectsDir, projectId);

	const plans = await scanPlanLinksForProject(projectsDir, projectId);

	return {
		id: projectId,
		name: sessions[0]?.projectName ?? (await resolveProjectName(projectId)),
		projectPath: sessions[0]?.projectPath,
		sessions,
		memories,
		plans,
	};
}
