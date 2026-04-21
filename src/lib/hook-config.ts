/**
 * Generates the Claude Code hooks configuration block for ~/.claude/settings.json.
 *
 * Each hook event fires a curl POST to the local server's /api/hook endpoint,
 * passing along event metadata as JSON. The server uses this for real-time
 * session tracking, task completion notifications, and SSE broadcasts.
 */

export const DEFAULT_HOOK_PORT = 7526;

/**
 * All Claude hook event names that the server handles.
 * Must stay in sync with HookEventEnvelope in hook-events.ts.
 */
export const HOOK_EVENT_NAMES = [
	'SessionStart',
	'SessionEnd',
	'Stop',
	'PostToolUse',
	'TaskCompleted',
	'WorktreeCreate',
] as const;

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];

interface HookEntry {
	type: 'command';
	command: string;
}

interface HookMatcher {
	hooks: HookEntry[];
}

export interface HooksConfig {
	hooks: Record<string, HookMatcher[]>;
}

function curlPost(port: number, jqExpr: string): string {
	return `curl -sX POST --connect-timeout 0.1 http://localhost:${port}/api/hook -H 'Content-Type: application/json' -d "$(echo '{}' | jq -c '${jqExpr}')" >/dev/null 2>&1 || true`;
}

/**
 * Build the jq expression that constructs the JSON body for a given event.
 * The stdin to jq is the hook context JSON provided by Claude Code.
 */
function jqExprForEvent(eventName: HookEventName): string {
	const base = `.session_id = $ENV.CLAUDE_SESSION_ID // "" | .hook_event_name = "${eventName}"`;

	switch (eventName) {
		case 'SessionStart':
			return `${base} | .cwd = $ENV.PWD // "" | .model = ($ENV.CLAUDE_MODEL // "")`;
		case 'SessionEnd':
			return base;
		case 'Stop':
			return base;
		case 'PostToolUse':
			return `${base} | .tool_name = ($ENV.CLAUDE_TOOL_NAME // "")`;
		case 'TaskCompleted':
			return `${base} | .task_id = ($ENV.CLAUDE_TASK_ID // "") | .task_subject = ($ENV.CLAUDE_TASK_SUBJECT // "")`;
		case 'WorktreeCreate':
			return `${base} | .name = ($ENV.CLAUDE_WORKTREE_NAME // "")`;
	}
}

export interface GenerateOptions {
	port?: number;
}

export function generateHooksConfig(options?: GenerateOptions): HooksConfig {
	const port = options?.port ?? DEFAULT_HOOK_PORT;
	const hooks: Record<string, HookMatcher[]> = {};

	for (const eventName of HOOK_EVENT_NAMES) {
		hooks[eventName] = [
			{
				hooks: [
					{
						type: 'command',
						command: curlPost(port, jqExprForEvent(eventName)),
					},
				],
			},
		];
	}

	return {hooks};
}

/**
 * Return a pretty-printed JSON string of just the hooks block,
 * suitable for copying into ~/.claude/settings.json.
 */
export function generateHooksJson(options?: GenerateOptions): string {
	return JSON.stringify(generateHooksConfig(options), null, 2);
}
