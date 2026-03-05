import {readdir, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {extractTitle} from './markdown-utils.js';

export interface MemoryEntry {
	filename: string;
	title: string;
	mtime: Date;
	project: string;
	projectName: string;
}

export interface ProjectGroup {
	project: string;
	projectName: string;
	memories: MemoryEntry[];
}

export function decodeProjectDir(encoded: string): string {
	const parts = encoded.replace(/^-/, '/').replace(/-/g, '/').split('/');
	return parts[parts.length - 1]!;
}

async function processProject(projectsDir: string, project: string): Promise<ProjectGroup | null> {
	const memDir = join(projectsDir, project, 'memory');
	let files: string[];
	try {
		files = await readdir(memDir);
	} catch {
		return null;
	}

	const mdFiles = files.filter((f) => f.endsWith('.md'));
	if (mdFiles.length === 0) return null;

	const projectName = decodeProjectDir(project);

	const memories: MemoryEntry[] = await Promise.all(
		mdFiles.map(async (filename) => {
			const filePath = join(memDir, filename);
			const fileStat = await stat(filePath);
			const title = await extractTitle(filePath, filename);
			return {
				filename,
				title,
				mtime: fileStat.mtime,
				project,
				projectName,
			};
		}),
	);

	memories.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
	return {project, projectName, memories};
}

export async function listMemories(projectsDir: string): Promise<ProjectGroup[]> {
	let projectDirs: string[];
	try {
		projectDirs = await readdir(projectsDir);
	} catch {
		return [];
	}

	const results = await Promise.all(projectDirs.map((project) => processProject(projectsDir, project)));
	const groups = results.filter((g): g is ProjectGroup => g !== null);

	const maxMtimes = new Map(groups.map((g) => [g.project, Math.max(...g.memories.map((m) => m.mtime.getTime()))]));
	groups.sort((a, b) => maxMtimes.get(b.project)! - maxMtimes.get(a.project)!);

	return groups;
}

export async function readMemory(projectsDir: string, project: string, filename: string): Promise<string | null> {
	if (project.includes('..') || project.includes('/')) return null;
	if (filename.includes('..') || filename.includes('/') || !filename.endsWith('.md')) return null;

	try {
		const filePath = join(projectsDir, project, 'memory', filename);
		return await readFile(filePath, 'utf-8');
	} catch {
		return null;
	}
}

export function getProjectsDir(): string {
	return join(homedir(), '.claude', 'projects');
}
