import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {toggleStar as toggleStarInDb} from './db/queries';

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

export const toggleSessionStar = createServerFn({method: 'POST'})
	.inputValidator(z.string())
	.handler(async ({data: sessionId}) => {
		const {getDb} = await import('./db');
		const {index} = getDb();
		const starred = toggleStarInDb(index, sessionId);
		return {starred};
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

// ---------------------------------------------------------------------------
// Hook installation
// ---------------------------------------------------------------------------

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
// Settings viewer
// ---------------------------------------------------------------------------

const SETTINGS_FILENAMES = ['settings.json', 'settings.local.json'] as const;

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
