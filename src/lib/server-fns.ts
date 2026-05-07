import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {
	listSessionsForProjectFromDb,
	getProjectDetailFromDb,
	searchSessionsFromDb,
	getSubagentsForProject,
	getPlanProjectMappings,
	toggleStar as toggleStarInDb,
	getStarredSessions as getStarredSessionsFromDb,
	searchMessageContentDb,
	getIncompleteTasksGroupedByProject,
	getTasksForProject,
	getTaskCountsForProject,
	listBranchesForProject,
} from './db/queries';

async function claudeDirs() {
	const {homedir} = await import('node:os');
	const {join} = await import('node:path');
	const home = homedir();
	return {
		plansDir: join(home, '.claude', 'plans'),
		projectsDir: join(home, '.claude', 'projects'),
		claudeHome: join(home, '.claude'),
		join,
	};
}

export const getPlans = createServerFn({method: 'GET'}).handler(async () => {
	const {plansDir} = await claudeDirs();
	const {listPlans} = await import('./plans');
	const plans = await listPlans(plansDir);
	return plans.map((p) => ({
		filename: p.filename,
		title: p.title,
		mtime: p.mtime.toISOString(),
	}));
});

type PlanGroupResult = {
	projectId: string;
	projectName: string;
	plans: Array<{filename: string; title: string; mtime: string}>;
};

export const getPlansGrouped = createServerFn({method: 'GET'}).handler(async () => {
	const {plansDir} = await claudeDirs();
	const {listPlans} = await import('./plans');
	const plans = await listPlans(plansDir);
	const {getDb} = await import('./db');
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
				groups.set('__unlinked__', {
					projectName: 'Unlinked',
					plans: [plan],
				});
			}
		} else {
			for (const proj of projects) {
				const group = groups.get(proj.projectId);
				if (group) {
					group.plans.push(plan);
				} else {
					groups.set(proj.projectId, {
						projectName: proj.projectName,
						plans: [plan],
					});
				}
			}
		}
	}

	const result: PlanGroupResult[] = Array.from(groups.entries()).map(([projectId, group]) => ({
		projectId,
		projectName: group.projectName,
		plans: group.plans,
	}));
	return result;
});

export const getMemories = createServerFn({method: 'GET'}).handler(async () => {
	const {projectsDir} = await claudeDirs();
	const {listMemories} = await import('./memory');
	const groups = await listMemories(projectsDir);
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

export const getProject = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: projectId}) => {
		const {projectsDir, plansDir, join} = await claudeDirs();
		const {getDb} = await import('./db');
		const {index} = getDb();
		const detail = getProjectDetailFromDb(index, projectId);
		if (!detail) return null;

		// Get memories from filesystem (still user-editable .md files)
		const memDir = join(projectsDir, projectId, 'memory');
		const memories: Array<{
			filename: string;
			title: string;
			mtime: string;
			project: string;
		}> = [];
		try {
			const {readdir, stat} = await import('node:fs/promises');
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

		const allSubagents = getSubagentsForProject(index, projectId);
		const subagentCountBySession = new Map<string, number>();
		for (const a of allSubagents) {
			subagentCountBySession.set(a.sessionId, (subagentCountBySession.get(a.sessionId) ?? 0) + 1);
		}

		const rawTodos = getTasksForProject(index, detail.name);
		const todoCounts = getTaskCountsForProject(index, detail.name);
		const [{renderInlineMarkdown, renderMarkdown}, {extractTitle}] = await Promise.all([
			import('./renderer'),
			import('./markdown-utils'),
		]);
		const todos = await Promise.all(
			rawTodos.map(async (task) => ({
				...task,
				subjectHtml: await renderInlineMarkdown(task.subject),
				descriptionHtml: await renderMarkdown(task.description),
			})),
		);

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
				subagentCount: subagentCountBySession.get(s.id) ?? 0,
			})),
			memories,
			todos,
			todoCounts,
			plans: await Promise.all(
				[...new Map(detail.planLinks.map((p) => [p.planFilename, p])).values()].map(async (p) => {
					const planPath = join(plansDir, p.planFilename);
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

export const searchSessions = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: query}) => {
		const {getDb} = await import('./db');
		const {index} = getDb();
		return searchSessionsFromDb(index, query);
	});

export const toggleSessionStar = createServerFn({method: 'POST'})
	.inputValidator(z.string())
	.handler(async ({data: sessionId}) => {
		const {getDb} = await import('./db');
		const {index} = getDb();
		const starred = toggleStarInDb(index, sessionId);
		return {starred};
	});

export const getStarredSessionList = createServerFn({method: 'GET'}).handler(async () => {
	const {getDb} = await import('./db');
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

export const searchMessageContent = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: query}) => {
		const {getDb} = await import('./db');
		const {index} = getDb();
		return searchMessageContentDb(index, query);
	});

export const requestSummary = createServerFn({method: 'POST'})
	.inputValidator(z.string())
	.handler(async ({data: sessionId}) => {
		const {getDb} = await import('./db');
		const {summaries} = getDb();
		const {generateSummary} = await import('./summaries');
		const summary = await generateSummary(summaries, sessionId);
		return {summary};
	});

export const getPluginsList = createServerFn({method: 'GET'}).handler(async () => {
	const {listPlugins} = await import('./plugins');
	return listPlugins();
});

export const getPluginGroups = createServerFn({method: 'GET'}).handler(async () => {
	const {listPlugins, listMarketplaces, groupPluginsByMarketplace, isOfficialMarketplace} = await import('./plugins');
	const [plugins, marketplaces] = await Promise.all([listPlugins(), listMarketplaces()]);
	const groups = groupPluginsByMarketplace(plugins, marketplaces);
	return groups.map((g) => ({
		...g,
		isOfficial: isOfficialMarketplace(g.marketplace.id),
	}));
});

export const getUserCommandsList = createServerFn({method: 'GET'}).handler(async () => {
	const {listUserCommands} = await import('./plugins');
	return listUserCommands();
});

export const getPluginTree = createServerFn({method: 'GET'})
	.inputValidator(z.object({pluginId: z.string()}))
	.handler(async ({data: {pluginId}}) => {
		const {listPlugins, scanPluginTree} = await import('./plugins');
		const plugins = await listPlugins();
		const plugin = plugins.find((p) => p.id === pluginId);
		if (!plugin) return null;
		return scanPluginTree(plugin.installPath);
	});

export const getPluginFileRendered = createServerFn({method: 'GET'})
	.inputValidator(z.object({pluginId: z.string(), pathSegments: z.array(z.string())}))
	.handler(async ({data: {pluginId, pathSegments}}) => {
		const {listPlugins, readPluginFileContent, parseFrontmatter} = await import('./plugins');
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
		const {readUserCommandContent} = await import('./plugins');
		const content = await readUserCommandContent(source, filename);
		if (!content) return null;

		const {renderMarkdown} = await import('./renderer');
		const html = await renderMarkdown(content);
		const {extractTitleFromContent} = await import('./markdown-utils');
		const title = extractTitleFromContent(content, filename);
		const sourceName = source === 'global' ? 'Global' : (await import('./memory')).decodeProjectDir(source);
		return {html, title, sourceName};
	});

// ---------------------------------------------------------------------------
// Hook installation
// ---------------------------------------------------------------------------

export const getHookStatus = createServerFn({method: 'GET'}).handler(async () => {
	const {claudeHome, join} = await claudeDirs();
	const {generateHooksConfig, HOOK_EVENT_NAMES} = await import('./hook-config');
	const settingsPath = join(claudeHome, 'settings.json');
	const {readFile} = await import('node:fs/promises');

	let existing: Record<string, unknown> = {};
	try {
		const raw = await readFile(settingsPath, 'utf-8');
		existing = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return {installed: false, partial: false, settingsPath};
	}

	const hooks = existing['hooks'] as Record<string, unknown[]> | undefined;
	if (!hooks) return {installed: false, partial: false, settingsPath};

	const desired = generateHooksConfig();
	const installedCount = HOOK_EVENT_NAMES.filter((name) => {
		const entries = hooks[name];
		if (!Array.isArray(entries)) return false;
		const desiredCmd = (desired.hooks[name]?.[0]?.hooks[0] as {command: string} | undefined)?.command;
		return entries.some((e) => {
			const entryHooks = (e as {hooks?: Array<{command?: string}>}).hooks;
			return entryHooks?.some((h) => h.command === desiredCmd);
		});
	}).length;

	return {
		installed: installedCount === HOOK_EVENT_NAMES.length,
		partial: installedCount > 0 && installedCount < HOOK_EVENT_NAMES.length,
		installedCount,
		totalCount: HOOK_EVENT_NAMES.length,
		settingsPath,
	};
});

export const installHooks = createServerFn({method: 'POST'})
	.inputValidator((input: unknown) => z.object({port: z.number().optional()}).parse(input))
	.handler(async ({data}) => {
		const {claudeHome, join} = await claudeDirs();
		const {generateHooksConfig} = await import('./hook-config');
		const {readFile, writeFile, mkdir} = await import('node:fs/promises');
		const settingsPath = join(claudeHome, 'settings.json');
		const config = generateHooksConfig(data.port !== undefined ? {port: data.port} : undefined);

		// Ensure ~/.claude/ exists
		await mkdir(claudeHome, {recursive: true});

		// Read existing settings
		let existing: Record<string, unknown> = {};
		try {
			const raw = await readFile(settingsPath, 'utf-8');
			existing = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			// File doesn't exist or is invalid — start fresh
		}

		// Merge hooks: for each event, replace any existing entry with matching command prefix
		const existingHooks = (existing['hooks'] ?? {}) as Record<string, unknown[]>;
		for (const [eventName, matchers] of Object.entries(config.hooks)) {
			const desiredCmd = matchers[0]?.hooks[0]?.command;
			if (!desiredCmd) continue;

			const cmdPrefix = desiredCmd.slice(0, desiredCmd.indexOf('/api/hook'));
			const eventEntries = Array.isArray(existingHooks[eventName]) ? [...existingHooks[eventName]] : [];

			// Remove any existing entry that posts to our server
			const filtered = eventEntries.filter((e) => {
				const entryHooks = (e as {hooks?: Array<{command?: string}>}).hooks;
				return !entryHooks?.some((h) => h.command?.includes(cmdPrefix + '/api/hook'));
			});

			// Add our entry
			filtered.push(...matchers);
			existingHooks[eventName] = filtered;
		}

		existing['hooks'] = existingHooks;

		await writeFile(settingsPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
		return {ok: true, settingsPath};
	});

export const uninstallHooks = createServerFn({method: 'POST'})
	.inputValidator((input: unknown) => z.object({port: z.number().optional()}).parse(input))
	.handler(async ({data}) => {
		const {claudeHome, join} = await claudeDirs();
		const {generateHooksConfig} = await import('./hook-config');
		const {readFile, writeFile} = await import('node:fs/promises');
		const settingsPath = join(claudeHome, 'settings.json');
		const config = generateHooksConfig(data.port !== undefined ? {port: data.port} : undefined);

		let existing: Record<string, unknown>;
		try {
			const raw = await readFile(settingsPath, 'utf-8');
			existing = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return {ok: true, settingsPath};
		}

		const existingHooks = (existing['hooks'] ?? {}) as Record<string, unknown[]>;
		for (const [eventName, matchers] of Object.entries(config.hooks)) {
			const desiredCmd = matchers[0]?.hooks[0]?.command;
			if (!desiredCmd) continue;

			const cmdPrefix = desiredCmd.slice(0, desiredCmd.indexOf('/api/hook'));
			const eventEntries = existingHooks[eventName];
			if (!Array.isArray(eventEntries)) continue;

			existingHooks[eventName] = eventEntries.filter((e) => {
				const entryHooks = (e as {hooks?: Array<{command?: string}>}).hooks;
				return !entryHooks?.some((h) => h.command?.includes(cmdPrefix + '/api/hook'));
			});

			if ((existingHooks[eventName] as unknown[]).length === 0) {
				delete existingHooks[eventName];
			}
		}

		if (Object.keys(existingHooks).length === 0) {
			delete existing['hooks'];
		}

		await writeFile(settingsPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
		return {ok: true, settingsPath};
	});

// ---------------------------------------------------------------------------
// Task management
// ---------------------------------------------------------------------------

export const getTasks = createServerFn({method: 'GET'}).handler(async () => {
	const {getDb} = await import('./db');
	const {index} = getDb();
	const groups = getIncompleteTasksGroupedByProject(index);
	const {renderInlineMarkdown, renderMarkdown} = await import('./renderer');

	return Promise.all(
		groups.map(async (group) => ({
			...group,
			tasks: await Promise.all(
				group.tasks.map(async (task) => ({
					...task,
					subjectHtml: await renderInlineMarkdown(task.subject),
					descriptionHtml: await renderMarkdown(task.description),
				})),
			),
		})),
	);
});

// ---------------------------------------------------------------------------
// Project-scoped sub-route data
// ---------------------------------------------------------------------------

export interface ProjectScopeBase {
	id: string;
	name: string;
	projectPath: string | null;
}

function projectScopeBase(detail: NonNullable<ReturnType<typeof getProjectDetailFromDb>>): ProjectScopeBase {
	return {id: detail.id, name: detail.name, projectPath: detail.projectPath};
}

export const getProjectMemoriesList = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: projectId}) => {
		const {projectsDir, join} = await claudeDirs();
		const {getDb} = await import('./db');
		const {index} = getDb();
		const detail = getProjectDetailFromDb(index, projectId);
		if (!detail) return null;

		const memDir = join(projectsDir, projectId, 'memory');
		const {readdir, stat} = await import('node:fs/promises');
		let mdFiles: string[];
		try {
			const files = await readdir(memDir);
			mdFiles = files.filter((f) => f.endsWith('.md'));
		} catch {
			return {project: projectScopeBase(detail), memories: []};
		}

		const settled = await Promise.all(
			mdFiles.map(async (filename) => {
				try {
					const fileStat = await stat(join(memDir, filename));
					return {
						filename,
						title: filename.replace(/\.md$/, ''),
						mtime: fileStat.mtime.toISOString(),
						project: projectId,
					};
				} catch {
					return null;
				}
			}),
		);
		const memories = settled.filter((m): m is NonNullable<typeof m> => m !== null);
		memories.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

		return {project: projectScopeBase(detail), memories};
	});

export const getProjectPlansList = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: projectId}) => {
		const {plansDir, join} = await claudeDirs();
		const {getDb} = await import('./db');
		const {index} = getDb();
		const detail = getProjectDetailFromDb(index, projectId);
		if (!detail) return null;

		const uniqueLinks = [...new Map(detail.planLinks.map((p) => [p.planFilename, p])).values()];
		const {stat} = await import('node:fs/promises');
		const {extractTitle} = await import('./markdown-utils');
		const plans = await Promise.all(
			uniqueLinks.map(async (p) => {
				const planPath = join(plansDir, p.planFilename);
				const [statResult, title] = await Promise.all([
					stat(planPath).catch(() => null),
					extractTitle(planPath, p.planFilename),
				]);
				return {
					filename: p.planFilename,
					title,
					mtime: statResult ? statResult.mtime.toISOString() : null,
					sessionId: p.sessionId,
				};
			}),
		);

		plans.sort((a, b) => {
			if (a.mtime && b.mtime) return new Date(b.mtime).getTime() - new Date(a.mtime).getTime();
			if (a.mtime) return -1;
			if (b.mtime) return 1;
			return a.filename.localeCompare(b.filename);
		});

		return {project: projectScopeBase(detail), plans};
	});

export const getProjectSessionsList = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: projectId}) => {
		const {getDb} = await import('./db');
		const {index} = getDb();
		const detail = getProjectDetailFromDb(index, projectId);
		if (!detail) return null;

		const sessions = listSessionsForProjectFromDb(index, projectId);
		const allSubagents = getSubagentsForProject(index, projectId);
		const subagentBySession = new Map<string, number>();
		for (const a of allSubagents) {
			subagentBySession.set(a.sessionId, (subagentBySession.get(a.sessionId) ?? 0) + 1);
		}

		return {
			project: projectScopeBase(detail),
			sessions: sessions.map((s) => ({
				id: s.id,
				title: s.title,
				summary: s.summary,
				mtime: s.mtime.toISOString(),
				created: s.created.toISOString(),
				messageCount: s.messageCount,
				gitBranch: s.gitBranch,
				subagentCount: subagentBySession.get(s.id) ?? 0,
			})),
		};
	});

export const getProjectBranches = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: projectId}) => {
		const {getDb} = await import('./db');
		const {index} = getDb();
		const branches = listBranchesForProject(index, projectId);
		return branches.map((b) => ({
			branch: b.branch,
			sessionCount: b.sessionCount,
			lastActivity: new Date(b.lastActivity).toISOString(),
		}));
	});

export const getProjectSubagents = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: projectId}) => {
		const {getDb} = await import('./db');
		const {index} = getDb();
		const detail = getProjectDetailFromDb(index, projectId);
		if (!detail) return null;

		const agents = getSubagentsForProject(index, projectId);

		return {
			project: projectScopeBase(detail),
			agents,
			subagentCount: agents.length,
		};
	});

export const getProjectTasksDetailed = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: projectId}) => {
		const {getDb} = await import('./db');
		const {index} = getDb();
		const detail = getProjectDetailFromDb(index, projectId);
		if (!detail) return null;

		const rawTodos = getTasksForProject(index, detail.name);
		const todoCounts = getTaskCountsForProject(index, detail.name);
		const {renderInlineMarkdown, renderMarkdown} = await import('./renderer');
		const todos = await Promise.all(
			rawTodos.map(async (task) => ({
				...task,
				subjectHtml: await renderInlineMarkdown(task.subject),
				descriptionHtml: await renderMarkdown(task.description),
			})),
		);

		return {project: projectScopeBase(detail), todos, todoCounts};
	});

// ---------------------------------------------------------------------------
// Settings viewer
// ---------------------------------------------------------------------------

const SETTINGS_FILENAMES = ['settings.json', 'settings.local.json'] as const;

export const getSettingsRaw = createServerFn({method: 'GET'}).handler(async () => {
	const {claudeHome, join} = await claudeDirs();
	const {readFile} = await import('node:fs/promises');

	const results: Array<{filename: string; path: string; exists: boolean; content: string}> = [];

	for (const filename of SETTINGS_FILENAMES) {
		const filePath = join(claudeHome, filename);
		try {
			const raw = await readFile(filePath, 'utf-8');
			const pretty = JSON.stringify(JSON.parse(raw), null, 2);
			results.push({filename, path: filePath, exists: true, content: pretty});
		} catch {
			results.push({filename, path: filePath, exists: false, content: '{}'});
		}
	}

	return results;
});

export const saveSettingsFile = createServerFn({method: 'POST'})
	.inputValidator(z.object({filename: z.enum(SETTINGS_FILENAMES), content: z.string()}))
	.handler(async ({data: {filename, content}}) => {
		const {claudeHome, join} = await claudeDirs();
		const {writeFile, mkdir} = await import('node:fs/promises');

		// Validate JSON before writing
		const parsed = JSON.parse(content) as unknown;
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			throw new Error('Settings must be a JSON object');
		}

		const pretty = JSON.stringify(parsed, null, 2) + '\n';
		const filePath = join(claudeHome, filename);

		await mkdir(claudeHome, {recursive: true});
		await writeFile(filePath, pretty, 'utf-8');

		return {path: filePath};
	});
