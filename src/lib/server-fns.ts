import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {listPlans} from './plans';
import {listMemories} from './memory';
import {listSessions} from './sessions';
import {listProjects, getProjectDetail} from './projects';
import {scanPlanLinks} from './plan-links';
import {extractTitle} from './markdown-utils';

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
	const groups = await listSessions(PROJECTS_DIR);
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
	const projects = await listProjects(PROJECTS_DIR);
	return projects.map((p) => ({
		id: p.id,
		name: p.name,
		projectPath: p.projectPath,
		sessionCount: p.sessionCount,
		memoryCount: p.memoryCount,
		lastActivity: p.lastActivity.toISOString(),
		gitBranch: p.gitBranch,
	}));
});

export const getProject = createServerFn({method: 'GET'})
	.inputValidator((d: string) => d)
	.handler(async ({data: projectId}) => {
		const detail = await getProjectDetail(PROJECTS_DIR, projectId);
		if (!detail) return null;
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
			})),
			memories: detail.memories.map((m) => ({
				filename: m.filename,
				title: m.title,
				mtime: m.mtime.toISOString(),
				project: m.project,
			})),
			plans: await Promise.all(
				[...new Map(detail.plans.map((p) => [p.planFilename, p])).values()].map(async (p) => {
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
		const links = await scanPlanLinks(PROJECTS_DIR);
		return links
			.filter((l) => l.planFilename === filename)
			.map((l) => ({
				sessionId: l.sessionId,
				project: l.project,
				projectName: l.projectName,
			}));
	});
