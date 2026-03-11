import {readdir, readFile, stat, writeFile} from 'node:fs/promises';
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

export function decodeProjectDir(encoded: string, projectPath?: string | undefined): string {
	if (projectPath) {
		const segments = projectPath.split('/');
		const last = segments[segments.length - 1];
		if (last) return last;
	}
	const parts = encoded.replace(/^-/, '/').replace(/-/g, '/').split('/');
	return parts[parts.length - 1]!;
}

const resolvedProjectNames = new Map<string, string>();

export async function resolveProjectName(encoded: string, projectPath?: string | undefined): Promise<string> {
	if (projectPath) {
		const segments = projectPath.split('/');
		const last = segments[segments.length - 1];
		if (last) return last;
	}

	const cached = resolvedProjectNames.get(encoded);
	if (cached) return cached;

	// The encoded dir name is the full path with / replaced by -.
	// e.g. "-Users-craig-projects-claude-code-plans" -> "/Users/craig/projects/claude-code-plans"
	// We need to find which hyphens are path separators vs part of dir names.
	// Strategy: try stat-ing candidate paths from right to left to find the real directory.
	const chars = encoded.slice(1); // remove leading -
	const hyphenPositions: number[] = [];
	for (let i = 0; i < chars.length; i++) {
		if (chars[i] === '-') hyphenPositions.push(i);
	}

	// Try each hyphen position from right to left as the last path separator
	for (let i = hyphenPositions.length - 1; i >= 0; i--) {
		const pos = hyphenPositions[i]!;
		const pathPart = '/' + chars.slice(0, pos).replace(/-/g, '/');
		const namePart = chars.slice(pos + 1);
		const candidate = pathPart + '/' + namePart;
		try {
			const s = await stat(candidate);
			if (s.isDirectory()) {
				resolvedProjectNames.set(encoded, namePart);
				return namePart;
			}
		} catch {
			// not a valid path, try next
		}
	}

	// Fallback: last segment of naive decode
	const name = decodeProjectDir(encoded);
	resolvedProjectNames.set(encoded, name);
	return name;
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

	const projectName = await resolveProjectName(project);

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

export async function writeMemory(
	projectsDir: string,
	project: string,
	filename: string,
	content: string,
): Promise<boolean> {
	if (project.includes('..') || project.includes('/')) return false;
	if (filename.includes('..') || filename.includes('/') || !filename.endsWith('.md')) return false;
	await writeFile(join(projectsDir, project, 'memory', filename), content, 'utf-8');
	return true;
}

export function getProjectsDir(): string {
	return join(homedir(), '.claude', 'projects');
}
