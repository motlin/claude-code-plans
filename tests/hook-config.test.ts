import {describe, expect, it} from 'vitest';
import {generateHooksConfig, DEFAULT_HOOK_PORT, HOOK_EVENT_NAMES} from '../src/lib/hook-config';

describe('HOOK_EVENT_NAMES', () => {
	it('contains all expected Claude hook event names', () => {
		expect([...HOOK_EVENT_NAMES].sort()).toStrictEqual(
			[
				'SessionStart',
				'SessionEnd',
				'Stop',
				'SubagentStop',
				'UserPromptSubmit',
				'Notification',
				'PreCompact',
				'PreToolUse',
				'PostToolUse',
				'TaskCompleted',
				'WorktreeCreate',
			].sort(),
		);
	});

	it('is re-exported from the hook-events module', async () => {
		const {KNOWN_HOOK_EVENTS} = await import('../src/lib/hook-events');
		expect(HOOK_EVENT_NAMES).toStrictEqual(KNOWN_HOOK_EVENTS);
	});
});

describe('generateHooksConfig', () => {
	it('returns valid JSON object with hooks key', () => {
		const config = generateHooksConfig();
		expect(Object.keys(config)).toStrictEqual(['hooks']);
		expect(typeof config.hooks).toBe('object');
	});

	it('uses default port', () => {
		const config = generateHooksConfig();
		const json = JSON.stringify(config);
		expect(json).toContain(`localhost:${DEFAULT_HOOK_PORT}`);
	});

	it('accepts a custom port', () => {
		const config = generateHooksConfig({port: 9000});
		const json = JSON.stringify(config);
		expect(json).toContain('localhost:9000');
		expect(json).not.toContain(`localhost:${DEFAULT_HOOK_PORT}`);
	});

	it('generates a hook entry for each supported event', () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, unknown>;
		expect(Object.keys(hooks).sort()).toStrictEqual([...HOOK_EVENT_NAMES].sort());
	});

	it('each hook entry posts to /api/hook', () => {
		const config = generateHooksConfig();
		const json = JSON.stringify(config);
		expect(json).toContain('/api/hook');
	});

	it('uses the same command for every hook event (single forwarder)', () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, Array<{hooks: Array<{type: string; command: string}>}>>;
		const commands = HOOK_EVENT_NAMES.map((name) => hooks[name]![0]!.hooks[0]!.command);
		const unique = new Set(commands);
		expect(unique.size).toBe(1);
	});

	it('forwards the full hook stdin payload via jq', () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, Array<{hooks: Array<{type: string; command: string}>}>>;
		const command = hooks['SessionStart']![0]!.hooks[0]!.command;
		// Pipes stdin through jq, not `echo '{}' | jq`
		expect(command).toContain('jq -c');
		expect(command).not.toContain("echo '{}'");
		// Posts the jq output as the request body
		expect(command).toContain('--data-binary @-');
	});

	it('merges CLAUDE-prefixed env vars into claude_env on every event', () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, Array<{hooks: Array<{type: string; command: string}>}>>;
		for (const eventName of HOOK_EVENT_NAMES) {
			const command = hooks[eventName]![0]!.hooks[0]!.command;
			expect(command).toContain('claude_env');
			expect(command).toContain('startswith("CLAUDE")');
		}
	});

	it('produces valid JSON when stringified', () => {
		const config = generateHooksConfig();
		const json = JSON.stringify(config, null, 2);
		const parsed: unknown = JSON.parse(json);
		expect(parsed).toStrictEqual(config);
	});

	it('all hooks suppress errors with || true and use --connect-timeout to never block', () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, Array<{hooks: Array<{type: string; command: string}>}>>;
		for (const eventName of HOOK_EVENT_NAMES) {
			const command = hooks[eventName]![0]!.hooks[0]!.command;
			expect(command).toContain('|| true');
			expect(command).toContain('--connect-timeout 0.1');
		}
	});
});
