import {readdir, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {extractTitle} from './markdown-utils.js';
import {resolveProjectName} from './memory.js';

export interface PluginFile {
	filename: string;
	name: string;
	description: string;
	type: 'agent' | 'command' | 'skill' | 'reference' | 'example';
	frontmatter: Record<string, string>;
}

export interface PluginSkill {
	dirname: string;
	name: string;
	description: string;
	skillFile: PluginFile;
	references: PluginFile[];
	examples: PluginFile[];
}

export interface PluginInfo {
	id: string;
	name: string;
	version: string;
	description: string;
	author: string;
	marketplace: string;
	installPath: string;
	agents: PluginFile[];
	commands: PluginFile[];
	skills: PluginSkill[];
}

export interface MarketplaceInfo {
	id: string;
	displayName: string;
	source: {source: string; repo?: string; path?: string};
}

export interface PluginGroup {
	marketplace: MarketplaceInfo;
	plugins: PluginInfo[];
}

export interface UserCommandGroup {
	source: string;
	sourceName: string;
	commands: PluginFile[];
}

export function parseFrontmatter(content: string): {frontmatter: Record<string, string>; body: string} {
	const frontmatter: Record<string, string> = {};
	if (!content.startsWith('---')) return {frontmatter, body: content};

	const endIdx = content.indexOf('\n---', 3);
	if (endIdx === -1) return {frontmatter, body: content};

	const fmBlock = content.slice(4, endIdx);
	for (const line of fmBlock.split('\n')) {
		const colonIdx = line.indexOf(':');
		if (colonIdx === -1) continue;
		const key = line.slice(0, colonIdx).trim();
		const value = line.slice(colonIdx + 1).trim();
		if (key) frontmatter[key] = value;
	}

	const body = content.slice(endIdx + 4).trimStart();
	return {frontmatter, body};
}

async function readMdFiles(dir: string, type: PluginFile['type']): Promise<PluginFile[]> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}

	const mdFiles = entries.filter((f) => f.endsWith('.md'));
	const files: PluginFile[] = [];

	for (const filename of mdFiles) {
		try {
			const content = await readFile(join(dir, filename), 'utf-8');
			const {frontmatter} = parseFrontmatter(content);
			const name = frontmatter['name'] || (await extractTitle(join(dir, filename), filename));
			const description = frontmatter['description'] || '';
			files.push({filename, name, description, type, frontmatter});
		} catch {
			// skip unreadable files
		}
	}

	return files;
}

async function scanSkills(skillsDir: string): Promise<PluginSkill[]> {
	let dirs: string[];
	try {
		dirs = await readdir(skillsDir);
	} catch {
		return [];
	}

	const skills: PluginSkill[] = [];

	for (const dirname of dirs) {
		const skillPath = join(skillsDir, dirname);
		try {
			const s = await stat(skillPath);
			if (!s.isDirectory()) continue;
		} catch {
			continue;
		}

		const skillMdPath = join(skillPath, 'SKILL.md');
		let content: string;
		try {
			content = await readFile(skillMdPath, 'utf-8');
		} catch {
			continue;
		}

		const {frontmatter} = parseFrontmatter(content);
		const name = frontmatter['name'] || dirname;
		const description = frontmatter['description'] || '';
		const skillFile: PluginFile = {
			filename: 'SKILL.md',
			name,
			description,
			type: 'skill',
			frontmatter,
		};

		const references = await readMdFiles(join(skillPath, 'references'), 'reference');
		const examples = await readMdFiles(join(skillPath, 'examples'), 'example');

		skills.push({dirname, name, description, skillFile, references, examples});
	}

	return skills;
}

export function extractMarketplace(pluginId: string): string {
	const atIdx = pluginId.indexOf('@');
	if (atIdx === -1) return 'unknown';
	return pluginId.slice(atIdx + 1);
}

export async function listMarketplaces(): Promise<Record<string, MarketplaceInfo>> {
	const marketplacesPath = join(homedir(), '.claude', 'plugins', 'known_marketplaces.json');
	try {
		const raw = await readFile(marketplacesPath, 'utf-8');
		const data = JSON.parse(raw) as Record<string, {source: {source: string; repo?: string; path?: string}}>;
		const result: Record<string, MarketplaceInfo> = {};
		for (const [id, info] of Object.entries(data)) {
			result[id] = {
				id,
				displayName: formatMarketplaceName(id),
				source: info.source,
			};
		}

		return result;
	} catch {
		return {};
	}
}

export function formatMarketplaceName(id: string): string {
	return id
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

export function groupPluginsByMarketplace(
	plugins: PluginInfo[],
	marketplaces: Record<string, MarketplaceInfo>,
): PluginGroup[] {
	const groups = new Map<string, PluginGroup>();

	for (const plugin of plugins) {
		const marketplaceId = plugin.marketplace;
		if (!groups.has(marketplaceId)) {
			const info = marketplaces[marketplaceId] || {
				id: marketplaceId,
				displayName: formatMarketplaceName(marketplaceId),
				source: {source: 'unknown'},
			};
			groups.set(marketplaceId, {marketplace: info, plugins: []});
		}

		groups.get(marketplaceId)!.plugins.push(plugin);
	}

	// Sort groups: official first, then alphabetically
	const sorted = [...groups.values()].sort((a, b) => {
		const aOfficial = isOfficialMarketplace(a.marketplace.id);
		const bOfficial = isOfficialMarketplace(b.marketplace.id);
		if (aOfficial !== bOfficial) return aOfficial ? -1 : 1;
		return a.marketplace.displayName.localeCompare(b.marketplace.displayName);
	});

	return sorted;
}

export function isOfficialMarketplace(marketplaceId: string): boolean {
	return marketplaceId === 'claude-plugins-official' || marketplaceId === 'anthropic-agent-skills';
}

export async function listPlugins(): Promise<PluginInfo[]> {
	const registryPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
	let registry: {plugins: Record<string, Array<{installPath: string; version: string}>>};
	try {
		const raw = await readFile(registryPath, 'utf-8');
		registry = JSON.parse(raw);
	} catch {
		return [];
	}

	const plugins: PluginInfo[] = [];

	for (const [id, installs] of Object.entries(registry.plugins)) {
		const install = installs[0];
		if (!install) continue;

		let pluginJson: {name?: string; version?: string; description?: string; author?: {name?: string}} = {};
		try {
			const raw = await readFile(join(install.installPath, '.claude-plugin', 'plugin.json'), 'utf-8');
			pluginJson = JSON.parse(raw);
		} catch {
			// no plugin.json
		}

		const agents = await readMdFiles(join(install.installPath, 'agents'), 'agent');
		const commands = await readMdFiles(join(install.installPath, 'commands'), 'command');
		const skills = await scanSkills(join(install.installPath, 'skills'));

		plugins.push({
			id,
			name: pluginJson.name || id.split('@')[0] || id,
			version: pluginJson.version || install.version,
			description: pluginJson.description || '',
			author: pluginJson.author?.name || '',
			marketplace: extractMarketplace(id),
			installPath: install.installPath,
			agents,
			commands,
			skills,
		});
	}

	plugins.sort((a, b) => a.name.localeCompare(b.name));
	return plugins;
}

export async function listUserCommands(): Promise<UserCommandGroup[]> {
	const globalDir = join(homedir(), '.claude', 'commands');
	const globalCmds = await readMdFiles(globalDir, 'command');

	const groups: UserCommandGroup[] = [];
	if (globalCmds.length > 0) {
		groups.push({source: 'global', sourceName: 'Global', commands: globalCmds});
	}

	const projectsDir = join(homedir(), '.claude', 'projects');
	let projectDirs: string[];
	try {
		projectDirs = await readdir(projectsDir);
	} catch {
		return groups;
	}

	for (const project of projectDirs) {
		const cmdDir = join(projectsDir, project, 'commands');
		const cmds = await readMdFiles(cmdDir, 'command');
		if (cmds.length > 0) {
			const projectName = await resolveProjectName(project);
			groups.push({source: project, sourceName: projectName, commands: cmds});
		}
	}

	return groups;
}

export async function readPluginFileContent(installPath: string, ...pathSegments: string[]): Promise<string | null> {
	for (const seg of pathSegments) {
		if (seg.includes('..')) return null;
	}

	try {
		const filePath = join(installPath, ...pathSegments);
		return await readFile(filePath, 'utf-8');
	} catch {
		return null;
	}
}

export async function readUserCommandContent(source: string, filename: string): Promise<string | null> {
	if (filename.includes('..') || filename.includes('/') || !filename.endsWith('.md')) return null;

	let dir: string;
	if (source === 'global') {
		dir = join(homedir(), '.claude', 'commands');
	} else {
		if (source.includes('..') || source.includes('/')) return null;
		dir = join(homedir(), '.claude', 'projects', source, 'commands');
	}

	try {
		return await readFile(join(dir, filename), 'utf-8');
	} catch {
		return null;
	}
}

export function getPluginInstallPath(plugins: PluginInfo[], pluginId: string): string | undefined {
	return plugins.find((p) => p.id === pluginId)?.installPath;
}
