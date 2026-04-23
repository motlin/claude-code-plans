import {describe, expect, it} from 'vitest';
import {generateHooksConfig, DEFAULT_HOOK_PORT, HOOK_EVENT_NAMES} from '../src/lib/hook-config';

describe('HOOK_EVENT_NAMES', () => {
	it('contains all expected Claude hook event names', () => {
		expect(HOOK_EVENT_NAMES).toStrictEqual([
			'SessionStart',
			'SessionEnd',
			'Stop',
			'PostToolUse',
			'TaskCompleted',
			'WorktreeCreate',
		]);
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

	it('each hook uses curl to POST JSON with session_id and hook_event_name', () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, Array<{hooks: Array<{type: string; command: string}>}>>;

		for (const eventName of HOOK_EVENT_NAMES) {
			const entries = hooks[eventName];
			if (!entries || entries.length === 0) throw new Error(`No entries for ${eventName}`);

			const hookDef = entries[0]!;
			if (hookDef.hooks.length === 0) throw new Error(`No hooks for ${eventName}`);

			const command = hookDef.hooks[0]!.command;
			expect(command).toContain('curl');
			expect(command).toContain('POST');
			expect(command).toContain('hook_event_name');
		}
	});

	it('SessionStart hook includes model and cwd fields', () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, Array<{hooks: Array<{type: string; command: string}>}>>;
		const command = hooks['SessionStart']![0]!.hooks[0]!.command;
		expect(command).toContain('model');
		expect(command).toContain('cwd');
	});

	it('PostToolUse hook includes tool_name field', () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, Array<{hooks: Array<{type: string; command: string}>}>>;
		const command = hooks['PostToolUse']![0]!.hooks[0]!.command;
		expect(command).toContain('tool_name');
	});

	it('TaskCompleted hook includes task fields', () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, Array<{hooks: Array<{type: string; command: string}>}>>;
		const command = hooks['TaskCompleted']![0]!.hooks[0]!.command;
		expect(command).toContain('task_id');
	});

	it('produces valid JSON when stringified', () => {
		const config = generateHooksConfig();
		const json = JSON.stringify(config, null, 2);
		const parsed: unknown = JSON.parse(json);
		expect(parsed).toStrictEqual(config);
	});

	it('all hooks suppress errors with || true', () => {
		const config = generateHooksConfig();
		// Every curl command should be non-blocking (fail silently)
		const hooks = config.hooks as Record<string, Array<{hooks: Array<{type: string; command: string}>}>>;
		for (const eventName of HOOK_EVENT_NAMES) {
			const command = hooks[eventName]![0]!.hooks[0]!.command;
			expect(command).toContain('|| true');
		}
	});
});
