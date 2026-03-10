import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {listPlans} from './plans';
import {listMemories} from './memory';
import {listSessions} from './sessions';

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
			mtime: s.mtime.toISOString(),
			project: s.project,
			projectName: s.projectName,
		})),
	}));
});
