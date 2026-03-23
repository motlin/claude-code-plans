import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
	parseFrontmatter,
	readPluginFileContent,
	readUserCommandContent,
	extractMarketplace,
	formatMarketplaceName,
	groupPluginsByMarketplace,
	isOfficialMarketplace,
	scanPluginTree,
} from '../src/lib/plugins.js';
import type {PluginInfo, MarketplaceInfo} from '../src/lib/plugins.js';

const testDir = join(tmpdir(), 'claude-plugins-test-' + process.pid);

beforeEach(() => {
	mkdirSync(testDir, {recursive: true});
});

afterEach(() => {
	rmSync(testDir, {recursive: true, force: true});
});

describe('parseFrontmatter', () => {
	it('parses YAML frontmatter from content', () => {
		const content = '---\nname: test-agent\ndescription: A test agent\nmodel: sonnet\n---\n\n# Body';
		const {frontmatter, body} = parseFrontmatter(content);
		expect(frontmatter['name']).toBe('test-agent');
		expect(frontmatter['description']).toBe('A test agent');
		expect(frontmatter['model']).toBe('sonnet');
		expect(body).toBe('# Body');
	});

	it('returns empty frontmatter when no delimiters', () => {
		const content = '# Just markdown\n\nNo frontmatter here.';
		const {frontmatter, body} = parseFrontmatter(content);
		expect(frontmatter).toEqual({});
		expect(body).toBe(content);
	});

	it('returns empty frontmatter when no closing delimiter', () => {
		const content = '---\nname: broken\nNo closing delimiter';
		const {frontmatter, body} = parseFrontmatter(content);
		expect(frontmatter).toEqual({});
		expect(body).toBe(content);
	});

	it('handles empty frontmatter block', () => {
		const content = '---\n---\n\n# Body';
		const {frontmatter, body} = parseFrontmatter(content);
		expect(frontmatter).toEqual({});
		expect(body).toBe('# Body');
	});

	it('handles values with colons', () => {
		const content = '---\ndescription: Use this when: the user asks\n---\n\nBody';
		const {frontmatter, body} = parseFrontmatter(content);
		expect(frontmatter['description']).toBe('Use this when: the user asks');
		expect(body).toBe('Body');
	});

	it('skips lines without colons', () => {
		const content = '---\nname: test\njust a line\nversion: 1.0\n---\n\nBody';
		const {frontmatter} = parseFrontmatter(content);
		expect(frontmatter['name']).toBe('test');
		expect(frontmatter['version']).toBe('1.0');
		expect(Object.keys(frontmatter)).toHaveLength(2);
	});
});

describe('readPluginFileContent', () => {
	it('reads a file from an install path', async () => {
		const agentsDir = join(testDir, 'agents');
		mkdirSync(agentsDir, {recursive: true});
		writeFileSync(join(agentsDir, 'test.md'), '# Test Agent');

		const content = await readPluginFileContent(testDir, 'agents', 'test.md');
		expect(content).toBe('# Test Agent');
	});

	it('returns null for non-existent file', async () => {
		const content = await readPluginFileContent(testDir, 'agents', 'nope.md');
		expect(content).toBeNull();
	});

	it('rejects path traversal', async () => {
		const content = await readPluginFileContent(testDir, '..', 'etc', 'passwd');
		expect(content).toBeNull();
	});

	it('reads nested skill files', async () => {
		const skillDir = join(testDir, 'skills', 'my-skill', 'references');
		mkdirSync(skillDir, {recursive: true});
		writeFileSync(join(skillDir, 'ref.md'), '# Reference');

		const content = await readPluginFileContent(testDir, 'skills', 'my-skill', 'references', 'ref.md');
		expect(content).toBe('# Reference');
	});
});

describe('readUserCommandContent', () => {
	it('rejects path traversal in filename', async () => {
		const content = await readUserCommandContent('global', '../evil.md');
		expect(content).toBeNull();
	});

	it('rejects filenames with slashes', async () => {
		const content = await readUserCommandContent('global', 'sub/file.md');
		expect(content).toBeNull();
	});

	it('rejects non-md extension', async () => {
		const content = await readUserCommandContent('global', 'file.txt');
		expect(content).toBeNull();
	});

	it('rejects path traversal in source', async () => {
		const content = await readUserCommandContent('../evil', 'test.md');
		expect(content).toBeNull();
	});
});

describe('extractMarketplace', () => {
	it('extracts marketplace from plugin ID', () => {
		expect(extractMarketplace('hookify@claude-code-plugins')).toBe('claude-code-plugins');
	});

	it('returns unknown when no @ separator', () => {
		expect(extractMarketplace('standalone-plugin')).toBe('unknown');
	});

	it('handles IDs with multiple @ signs', () => {
		expect(extractMarketplace('plugin@scope@marketplace')).toBe('scope@marketplace');
	});
});

describe('formatMarketplaceName', () => {
	it('title-cases hyphenated names', () => {
		expect(formatMarketplaceName('claude-code-plugins')).toBe('Claude Code Plugins');
	});

	it('handles single word', () => {
		expect(formatMarketplaceName('unknown')).toBe('Unknown');
	});

	it('handles anthropic-agent-skills', () => {
		expect(formatMarketplaceName('anthropic-agent-skills')).toBe('Anthropic Agent Skills');
	});
});

describe('isOfficialMarketplace', () => {
	it('identifies claude-plugins-official', () => {
		expect(isOfficialMarketplace('claude-plugins-official')).toBe(true);
	});

	it('identifies anthropic-agent-skills', () => {
		expect(isOfficialMarketplace('anthropic-agent-skills')).toBe(true);
	});

	it('returns false for third-party', () => {
		expect(isOfficialMarketplace('claude-code-plugins')).toBe(false);
	});
});

describe('groupPluginsByMarketplace', () => {
	function makePlugin(id: string, name: string): PluginInfo {
		return {
			id,
			name,
			version: '1.0.0',
			description: '',
			author: '',
			marketplace: extractMarketplace(id),
			installPath: '/tmp/test',
			agents: [],
			commands: [],
			skills: [],
		};
	}

	const marketplaces: Record<string, MarketplaceInfo> = {
		'claude-plugins-official': {
			id: 'claude-plugins-official',
			displayName: 'Claude Plugins Official',
			source: {source: 'github', repo: 'anthropics/claude-plugins-official'},
		},
		'claude-code-plugins': {
			id: 'claude-code-plugins',
			displayName: 'Claude Code Plugins',
			source: {source: 'github', repo: 'anthropics/claude-code-plugins'},
		},
	};

	it('groups plugins by marketplace', () => {
		const plugins = [
			makePlugin('hookify@claude-code-plugins', 'hookify'),
			makePlugin('playwright@claude-plugins-official', 'playwright'),
			makePlugin('feature-dev@claude-code-plugins', 'feature-dev'),
		];

		const groups = groupPluginsByMarketplace(plugins, marketplaces);
		expect(groups).toHaveLength(2);
		// Official first
		expect(groups[0]!.marketplace.id).toBe('claude-plugins-official');
		expect(groups[0]!.plugins).toHaveLength(1);
		expect(groups[1]!.marketplace.id).toBe('claude-code-plugins');
		expect(groups[1]!.plugins).toHaveLength(2);
	});

	it('handles unknown marketplace gracefully', () => {
		const plugins = [makePlugin('my-plugin@custom-marketplace', 'my-plugin')];
		const groups = groupPluginsByMarketplace(plugins, marketplaces);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.marketplace.displayName).toBe('Custom Marketplace');
	});

	it('returns empty array for no plugins', () => {
		expect(groupPluginsByMarketplace([], marketplaces)).toEqual([]);
	});

	it('sorts official marketplaces before third-party', () => {
		const plugins = [
			makePlugin('a@zzz-marketplace', 'a'),
			makePlugin('b@anthropic-agent-skills', 'b'),
			makePlugin('c@claude-plugins-official', 'c'),
			makePlugin('d@aaa-marketplace', 'd'),
		];
		const groups = groupPluginsByMarketplace(plugins, {});
		const ids = groups.map((g) => g.marketplace.id);
		// Both official first (alphabetically among themselves), then third-party alphabetically
		expect(ids).toEqual([
			'anthropic-agent-skills',
			'claude-plugins-official',
			'aaa-marketplace',
			'zzz-marketplace',
		]);
	});
});

describe('scanPluginTree', () => {
	it('returns a tree of files and directories', async () => {
		mkdirSync(join(testDir, 'agents'), {recursive: true});
		mkdirSync(join(testDir, 'commands'), {recursive: true});
		writeFileSync(join(testDir, 'README.md'), '# Hello');
		writeFileSync(join(testDir, 'agents', 'bot.md'), '# Bot');
		writeFileSync(join(testDir, 'commands', 'run.md'), '# Run');

		const tree = await scanPluginTree(testDir);
		expect(tree).not.toBeNull();

		// Root should have children
		const names = tree!.children!.map((c) => c.name).sort();
		expect(names).toContain('README.md');
		expect(names).toContain('agents');
		expect(names).toContain('commands');

		// Directories should have children
		const agentsNode = tree!.children!.find((c) => c.name === 'agents');
		expect(agentsNode?.type).toBe('directory');
		expect(agentsNode?.children).toHaveLength(1);
		expect(agentsNode?.children![0]!.name).toBe('bot.md');
		expect(agentsNode?.children![0]!.type).toBe('file');
	});

	it('returns null for non-existent directory', async () => {
		const tree = await scanPluginTree(join(testDir, 'nonexistent'));
		expect(tree).toBeNull();
	});

	it('excludes node_modules and .git directories', async () => {
		mkdirSync(join(testDir, 'node_modules', 'dep'), {recursive: true});
		mkdirSync(join(testDir, '.git', 'objects'), {recursive: true});
		mkdirSync(join(testDir, 'src'), {recursive: true});
		writeFileSync(join(testDir, 'node_modules', 'dep', 'index.js'), '');
		writeFileSync(join(testDir, '.git', 'objects', 'abc'), '');
		writeFileSync(join(testDir, 'src', 'main.ts'), '');

		const tree = await scanPluginTree(testDir);
		const names = tree!.children!.map((c) => c.name);
		expect(names).not.toContain('node_modules');
		expect(names).not.toContain('.git');
		expect(names).toContain('src');
	});

	it('sorts directories before files, then alphabetically', async () => {
		mkdirSync(join(testDir, 'beta'), {recursive: true});
		mkdirSync(join(testDir, 'alpha'), {recursive: true});
		writeFileSync(join(testDir, 'zebra.md'), '');
		writeFileSync(join(testDir, 'aardvark.md'), '');

		const tree = await scanPluginTree(testDir);
		const names = tree!.children!.map((c) => c.name);
		// Directories first (alphabetically), then files (alphabetically)
		expect(names).toEqual(['alpha', 'beta', 'aardvark.md', 'zebra.md']);
	});

	it('includes relative path for each node', async () => {
		mkdirSync(join(testDir, 'skills', 'my-skill'), {recursive: true});
		writeFileSync(join(testDir, 'skills', 'my-skill', 'SKILL.md'), '');

		const tree = await scanPluginTree(testDir);
		const skillsNode = tree!.children!.find((c) => c.name === 'skills');
		const mySkillNode = skillsNode!.children!.find((c) => c.name === 'my-skill');
		const skillMd = mySkillNode!.children!.find((c) => c.name === 'SKILL.md');

		expect(skillsNode!.path).toBe('skills');
		expect(mySkillNode!.path).toBe('skills/my-skill');
		expect(skillMd!.path).toBe('skills/my-skill/SKILL.md');
	});
});
