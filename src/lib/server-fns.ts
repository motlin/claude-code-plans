import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {
	searchSessionsFromDb,
	toggleStar as toggleStarInDb,
	getStarredSessions as getStarredSessionsFromDb,
	searchMessageContentDb,
	getIncompleteTasksGroupedByProject,
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
