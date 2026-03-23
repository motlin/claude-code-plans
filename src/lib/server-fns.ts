import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readdir, stat} from 'node:fs/promises';
import {listPlans} from './plans';
import {listMemories} from './memory';
import {extractTitle} from './markdown-utils';
import {
	listPlugins,
	listMarketplaces,
	groupPluginsByMarketplace,
	isOfficialMarketplace,
	listUserCommands,
	readPluginFileContent,
	readUserCommandContent,
	parseFrontmatter,
} from './plugins';
import {getDb} from './db';
import {
	listProjectsFromDb,
	listSessionsFromDb,
	getProjectDetailFromDb,
	getPlanLinksFromDb,
	searchSessionsFromDb,
	getSubagentsForSession,
	getPlanProjectMappings,
	toggleStar as toggleStarInDb,
	getStarredSessions as getStarredSessionsFromDb,
	isSessionStarred as isSessionStarredInDb,
	searchMessageContent as searchMessageContentFromDb,
} from './db/queries';
import {getSummary, generateSummary} from './summaries';
import {getActiveSessions as getActiveSessionsList} from './active-sessions';

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

export const getPlansGrouped = createServerFn({method: 'GET'}).handler(async () => {
	const plans = await listPlans(PLANS_DIR);
	const {index} = getDb();
	const mappings = getPlanProjectMappings(index);

	// Build a map from planFilename -> {projectId, projectName}[]
	const planProjects = new Map<string, {projectId: string; projectName: string}[]>();
	for (const m of mappings) {
		const list = planProjects.get(m.planFilename);
		if (list) {
			list.push({projectId: m.projectId, projectName: m.projectName});
		} else {
			planProjects.set(m.planFilename, [{projectId: m.projectId, projectName: m.projectName}]);
		}
	}

	// Group plans by project. A plan linked to multiple projects appears in each.
	// Plans with no links go into "Unlinked".
	const groups = new Map<string, {projectName: string; plans: typeof serialized}>();
	const serialized = plans.map((p) => ({
		filename: p.filename,
		title: p.title,
		mtime: p.mtime.toISOString(),
	}));

	for (const plan of serialized) {
		const projects = planProjects.get(plan.filename);
		if (!projects || projects.length === 0) {
			const group = groups.get('__unlinked__');
			if (group) {
				group.plans.push(plan);
			} else {
				groups.set('__unlinked__', {projectName: 'Unlinked', plans: [plan]});
			}
		} else {
			for (const proj of projects) {
				const group = groups.get(proj.projectId);
				if (group) {
					group.plans.push(plan);
				} else {
					groups.set(proj.projectId, {projectName: proj.projectName, plans: [plan]});
				}
			}
		}
	}

	return Array.from(groups.entries()).map(([projectId, group]) => ({
		projectId,
		projectName: group.projectName,
		plans: group.plans,
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
	.inputValidator(z.string())
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

		// Get subagents per session
		const subagentsBySession = new Map<
			string,
			Array<{id: string; agentType: string | null; slug: string | null}>
		>();
		for (const sess of detail.sessions) {
			const agents = getSubagentsForSession(index, sess.id);
			if (agents.length > 0) {
				subagentsBySession.set(
					sess.id,
					agents.map((a) => ({id: a.id, agentType: a.agentType, slug: a.slug})),
				);
			}
		}

		return {
			id: detail.id,
			name: detail.name,
			projectPath: detail.projectPath,
			subagentCount: detail.subagentCount,
			sessions: detail.sessions.map((s) => ({
				id: s.id,
				title: s.title,
				summary: s.summary,
				mtime: s.mtime.toISOString(),
				created: s.created.toISOString(),
				messageCount: s.messageCount,
				gitBranch: s.gitBranch,
				subagents: subagentsBySession.get(s.id) ?? [],
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
	.inputValidator(z.string())
	.handler(async ({data: filename}) => {
		const {index} = getDb();
		const links = getPlanLinksFromDb(index, filename);
		return links.map((l) => ({
			sessionId: l.sessionId,
			project: l.projectId,
			projectName: l.projectName,
			sessionTitle: l.sessionTitle,
		}));
	});

export const getSubagents = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: sessionId}) => {
		const {index} = getDb();
		return getSubagentsForSession(index, sessionId);
	});

export const searchSessions = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: query}) => {
		const {index} = getDb();
		return searchSessionsFromDb(index, query);
	});

export const toggleSessionStar = createServerFn({method: 'POST'})
	.inputValidator(z.string())
	.handler(async ({data: sessionId}) => {
		const {index} = getDb();
		const starred = toggleStarInDb(index, sessionId);
		return {starred};
	});

export const getStarredSessionList = createServerFn({method: 'GET'}).handler(async () => {
	const {index} = getDb();
	const sessions = getStarredSessionsFromDb(index);
	return sessions.map((s) => ({
		id: s.id,
		title: s.title,
		summary: s.summary,
		mtime: s.mtime.toISOString(),
		created: s.created.toISOString(),
		project: s.project,
		projectName: s.projectName,
		messageCount: s.messageCount,
		gitBranch: s.gitBranch,
	}));
});

export const isStarred = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: sessionId}) => {
		const {index} = getDb();
		return {starred: isSessionStarredInDb(index, sessionId)};
	});

export const getActiveSessions = createServerFn({method: 'GET'}).handler(async () => {
	return getActiveSessionsList();
});

export const getIndexingStatus = createServerFn({method: 'GET'}).handler(async () => {
	const {isCurrentlyIndexing} = await import('./db/indexer');
	return {isIndexing: isCurrentlyIndexing()};
});

export const searchMessageContent = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: query}) => {
		const {index} = getDb();
		return searchMessageContentFromDb(index, query);
	});

export const getSessionSummary = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: sessionId}) => {
		const {summaries} = getDb();
		return {summary: getSummary(summaries, sessionId)};
	});

export const requestSummary = createServerFn({method: 'POST'})
	.inputValidator(z.string())
	.handler(async ({data: sessionId}) => {
		const {summaries} = getDb();
		const summary = await generateSummary(summaries, sessionId);
		return {summary};
	});

export const getPluginsList = createServerFn({method: 'GET'}).handler(async () => {
	return listPlugins();
});

export const getMarketplacesList = createServerFn({method: 'GET'}).handler(async () => {
	return listMarketplaces();
});

export const getPluginGroups = createServerFn({method: 'GET'}).handler(async () => {
	const [plugins, marketplaces] = await Promise.all([listPlugins(), listMarketplaces()]);
	const groups = groupPluginsByMarketplace(plugins, marketplaces);
	return groups.map((g) => ({
		...g,
		isOfficial: isOfficialMarketplace(g.marketplace.id),
	}));
});

export const getUserCommandsList = createServerFn({method: 'GET'}).handler(async () => {
	return listUserCommands();
});

export const getPluginFileRendered = createServerFn({method: 'GET'})
	.inputValidator(z.object({pluginId: z.string(), pathSegments: z.array(z.string())}))
	.handler(async ({data: {pluginId, pathSegments}}) => {
		const plugins = await listPlugins();
		const plugin = plugins.find((p) => p.id === pluginId);
		if (!plugin) return null;

		const content = await readPluginFileContent(plugin.installPath, ...pathSegments);
		if (!content) return null;

		const {renderMarkdown} = await import('./renderer');
		const {frontmatter, body} = parseFrontmatter(content);
		const html = await renderMarkdown(body);
		const {extractTitleFromContent} = await import('./markdown-utils');
		const title = frontmatter['name'] || extractTitleFromContent(body, pathSegments[pathSegments.length - 1] || '');
		return {html, title, frontmatter};
	});

export const getUserCommandRendered = createServerFn({method: 'GET'})
	.inputValidator(z.object({source: z.string(), filename: z.string()}))
	.handler(async ({data: {source, filename}}) => {
		const content = await readUserCommandContent(source, filename);
		if (!content) return null;

		const {renderMarkdown} = await import('./renderer');
		const html = await renderMarkdown(content);
		const {extractTitleFromContent} = await import('./markdown-utils');
		const title = extractTitleFromContent(content, filename);
		const sourceName = source === 'global' ? 'Global' : (await import('./memory')).decodeProjectDir(source);
		return {html, title, sourceName};
	});
