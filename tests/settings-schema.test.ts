import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {ClaudeSettingsSchema, SessionsIndexSchema} from '../src/lib/schemas';

describe('ClaudeSettingsSchema', () => {
	it('parses an empty settings object', () => {
		const result = ClaudeSettingsSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('parses settings with scalar fields', () => {
		const result = ClaudeSettingsSchema.safeParse({
			model: 'claude-opus-4-6',
			theme: 'dark',
			tui: 'fullscreen',
			verbose: true,
			includeCoAuthoredBy: false,
			alwaysThinkingEnabled: true,
			voiceEnabled: false,
			cleanupPeriodDays: 90,
			fileCheckpointingEnabled: true,
			autoUpdatesChannel: 'latest',
			skipDangerousModePermissionPrompt: false,
			teammateMode: 'in-process',
			preferredNotifChannel: 'ghostty',
		});
		expect(result.success).toBe(true);
	});

	it('parses settings with env key/value pairs', () => {
		const result = ClaudeSettingsSchema.safeParse({
			env: {
				DISABLE_TELEMETRY: '1',
				MY_VAR: 'hello',
			},
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.env).toStrictEqual({DISABLE_TELEMETRY: '1', MY_VAR: 'hello'});
		}
	});

	it('parses settings with permissions', () => {
		const result = ClaudeSettingsSchema.safeParse({
			permissions: {
				allow: ['Bash', 'Read', 'Write'],
				deny: ['Bash(rm -rf:*)'],
				ask: ['Edit(CLAUDE.md)'],
				defaultMode: 'plan',
			},
		});
		expect(result.success).toBe(true);
	});

	it('parses settings with hooks', () => {
		const result = ClaudeSettingsSchema.safeParse({
			hooks: {
				PostToolUse: [
					{
						matcher: 'Bash',
						hooks: [{type: 'command', command: 'echo hello'}],
					},
				],
				SessionStart: [
					{
						hooks: [{type: 'command', command: 'echo start', timeout: 5000}],
					},
				],
			},
		});
		expect(result.success).toBe(true);
	});

	it('parses settings with statusLine', () => {
		const result = ClaudeSettingsSchema.safeParse({
			statusLine: {
				type: 'command',
				command: '~/.claude/statusline.sh',
				padding: 0,
			},
		});
		expect(result.success).toBe(true);
	});

	it('parses settings with enabledPlugins', () => {
		const result = ClaudeSettingsSchema.safeParse({
			enabledPlugins: {
				'my-plugin@marketplace': true,
				'other-plugin@marketplace': false,
			},
		});
		expect(result.success).toBe(true);
	});

	it('parses settings with extraKnownMarketplaces', () => {
		const result = ClaudeSettingsSchema.safeParse({
			extraKnownMarketplaces: {
				'my-marketplace': {
					source: {source: 'github', repo: 'user/repo'},
				},
				'local-marketplace': {
					source: {source: 'directory', path: '/path/to/plugins'},
				},
			},
		});
		expect(result.success).toBe(true);
	});

	it('parses settings with $schema field', () => {
		const result = ClaudeSettingsSchema.safeParse({
			$schema: 'https://json.schemastore.org/claude-code-settings.json',
		});
		expect(result.success).toBe(true);
	});

	it('rejects unknown top-level fields', () => {
		const result = ClaudeSettingsSchema.safeParse({
			unknownField: 'value',
		});
		expect(result.success).toBe(false);
	});
});

describe('SessionsIndexSchema against disk', () => {
	const projectsDir = join(homedir(), '.claude', 'projects');

	it('validates all sessions-index.json files on disk', () => {
		let projectDirs: string[];
		try {
			projectDirs = readdirSync(projectsDir);
		} catch {
			return;
		}

		let validated = 0;
		const failures: string[] = [];

		for (const projectDir of projectDirs) {
			const projectPath = join(projectsDir, projectDir);
			let st: ReturnType<typeof statSync>;
			try {
				st = statSync(projectPath);
			} catch {
				continue;
			}
			if (!st.isDirectory()) continue;

			const indexPath = join(projectPath, 'sessions-index.json');
			let raw: string;
			try {
				raw = readFileSync(indexPath, 'utf-8');
			} catch {
				continue;
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				failures.push(`${projectDir}/sessions-index.json: invalid JSON`);
				continue;
			}

			const result = SessionsIndexSchema.safeParse(parsed);
			if (!result.success) {
				const issues = result.error.issues
					.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
					.join('\n');
				failures.push(`${projectDir}/sessions-index.json:\n${issues}`);
			} else {
				validated++;
			}
		}

		if (failures.length > 0) {
			throw new Error(`${failures.length} sessions-index.json files failed validation:\n${failures.join('\n')}`);
		}

		expect(validated).toBeGreaterThan(0);
	});
});

describe('ClaudeSettingsSchema against disk', () => {
	const claudeHome = join(homedir(), '.claude');

	for (const filename of ['settings.json', 'settings.local.json']) {
		it(`validates ${filename} on disk`, () => {
			const filePath = join(claudeHome, filename);
			let raw: string;
			try {
				raw = readFileSync(filePath, 'utf-8');
			} catch {
				// File doesn't exist, skip
				return;
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				throw new Error(`${filename}: invalid JSON`);
			}

			const result = ClaudeSettingsSchema.safeParse(parsed);
			if (!result.success) {
				const issues = result.error.issues
					.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
					.join('\n');
				throw new Error(`${filename} failed validation:\n${issues}`);
			}
		});
	}
});
