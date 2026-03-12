import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readdir, stat} from 'node:fs/promises';
import {listPlans} from './plans';
import {listMemories} from './memory';
import {extractTitle} from './markdown-utils';
import {getDb} from './db';
import {
	listProjectsFromDb,
	listSessionsFromDb,
	getProjectDetailFromDb,
	getPlanLinksFromDb,
	getSubagentsForSession,
} from './db/queries';

const PLANS_DIR = process.env['PLANS_DIR'] ?? join(homedir(), '.claude', 'plans');
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

export const getPlans = createServerFn({method: 'GET'}).handler(async () => {
	const plans = await listPlans(PLANS_DIR);
	return plans.map((p) => ({
		filename: p.filename,
		title: p.title,
		mtime: p.mtime.toISOString(),
	}));
});

export const getMemories = createServerFn({method: 'GET'}).handler(async () => {
	const groups = await listMemories(PROJECTS_DIR);
	return groups.map((g) => ({
		project: g.project,
		projectName: g.projectName,
		memories: g.memories.map((m) => ({
			filename: m.filename,
			title: m.title,
			mtime: m.mtime.toISOString(),
			project: m.project,
		})),
	}));
});

export const getSessions = createServerFn({method: 'GET'}).handler(async () => {
	const {index} = getDb();
	const groups = listSessionsFromDb(index);
	return groups.map((g) => ({
		project: g.project,
		projectName: g.projectName,
		sessions: g.sessions.map((s) => ({
			id: s.id,
			title: s.title,
			summary: s.summary,
			mtime: s.mtime.toISOString(),
			created: s.created.toISOString(),
			project: s.project,
			projectName: s.projectName,
			messageCount: s.messageCount,
			gitBranch: s.gitBranch,
		})),
	}));
});

export const getProjects = createServerFn({method: 'GET'}).handler(async () => {
	const {index} = getDb();
	const projects = listProjectsFromDb(index);

	// Enrich with memory counts (still from filesystem)
	const enriched = await Promise.all(
		projects.map(async (p) => {
			let memoryCount = 0;
			try {
				const memDir = join(PROJECTS_DIR, p.id, 'memory');
				const files = await readdir(memDir);
				memoryCount = files.filter((f) => f.endsWith('.md')).length;
			} catch {
				// no memory dir
			}
			return {
				id: p.id,
				name: p.name,
				projectPath: p.projectPath,
				sessionCount: p.sessionCount,
				memoryCount,
				lastActivity: new Date(p.lastActivity).toISOString(),
			};
		}),
	);

	return enriched;
});

export const getProject = createServerFn({method: 'GET'})
	.inputValidator((d: string) => d)
	.handler(async ({data: projectId}) => {
		const {index} = getDb();
		const detail = getProjectDetailFromDb(index, projectId);
		if (!detail) return null;

		// Get memories from filesystem (still user-editable .md files)
		const memDir = join(PROJECTS_DIR, projectId, 'memory');
		const memories: Array<{filename: string; title: string; mtime: string; project: string}> = [];
		try {
			const files = await readdir(memDir);
			const mdFiles = files.filter((f) => f.endsWith('.md'));
			for (const filename of mdFiles) {
				try {
					const fileStat = await stat(join(memDir, filename));
					memories.push({
						filename,
						title: filename.replace(/\.md$/, ''),
						mtime: fileStat.mtime.toISOString(),
						project: projectId,
					});
				} catch {
					// skip
				}
			}
			memories.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
		} catch {
			// no memory dir
		}

		return {
			id: detail.id,
			name: detail.name,
			projectPath: detail.projectPath,
			sessions: detail.sessions.map((s) => ({
				id: s.id,
				title: s.title,
				summary: s.summary,
				mtime: s.mtime.toISOString(),
				created: s.created.toISOString(),
				messageCount: s.messageCount,
				gitBranch: s.gitBranch,
				subagents: getSubagentsForSession(index, s.id).map((a) => ({
					id: a.id,
					agentType: a.agentType,
					slug: a.slug,
				})),
			})),
			memories,
			plans: await Promise.all(
				[...new Map(detail.planLinks.map((p) => [p.planFilename, p])).values()].map(async (p) => {
					const planPath = join(PLANS_DIR, p.planFilename);
					const title = await extractTitle(planPath, p.planFilename);
					return {
						filename: p.planFilename,
						title,
						sessionId: p.sessionId,
						projectName: p.projectName,
					};
				}),
			),
		};
	});

export const getPlanLinks = createServerFn({method: 'GET'})
	.inputValidator((d: string) => d)
	.handler(async ({data: filename}) => {
		const {index} = getDb();
		const links = getPlanLinksFromDb(index, filename);
		return links.map((l) => ({
			sessionId: l.sessionId,
			project: l.projectId,
			projectName: l.projectName,
		}));
	});
