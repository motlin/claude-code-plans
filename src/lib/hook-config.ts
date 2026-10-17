/**
 * Generates the Claude Code hooks configuration block for ~/.claude/settings.json.
 *
 * Each hook event fires a curl POST to the local server's /api/hook endpoint,
 * forwarding the full hook stdin payload from Claude Code (tool_input,
 * tool_response, transcript_path, prompt, etc.) merged with a snapshot of all
 * CLAUDE-prefixed environment variables (plus tmux and herdr identity vars) under
 * `claude_env`. The server uses this for real-time session tracking, task completion
 * notifications, SSE broadcasts, and mapping sessions to terminal panes.
 */

import {KNOWN_HOOK_EVENTS} from "./hook-events";
import type {HookEventName} from "./hook-events";
import {asRecord} from "./narrow";

export const DEFAULT_HOOK_PORT = 7526;

/**
 * All Claude hook event names that the server handles. Derived from the
 * `HookEventEnvelope` discriminated union in `hook-events.ts` so there is a
 * single source of truth — adding a new variant to the union automatically
 * adds a hook entry here without a second list to keep in sync.
 */
export const HOOK_EVENT_NAMES = KNOWN_HOOK_EVENTS;

interface HookEntry {
	type: "command";
	command: string;
}

interface HookMatcher {
	matcher?: string;
	hooks: HookEntry[];
}

interface HooksConfig {
	hooks: Record<string, HookMatcher[]>;
}

/**
 * Single jq filter applied to every hook event. Reads the full hook context
 * JSON from stdin (whatever Claude Code chose to send for this event) and
 * merges in a `claude_env` field carrying every CLAUDE-prefixed environment
 * variable plus the tmux `TMUX`/`TMUX_PANE` and herdr identity vars (selected
 * by exact name, used to map a session to its live terminal pane). We do *not*
 * strip any fields — the server-side strict Zod schema decides what's valid and
 * the schema-drift recovery path handles new fields.
 *
 * Exported so the round-trip test in `tests/hook-jq-roundtrip.test.ts` can
 * shell out to the exact same `jq` invocation a real hook would, against a
 * captured stdin payload, and assert the result still parses cleanly under
 * `HookEventEnvelope`.
 */
export const HOOK_PAYLOAD_JQ_FILTER =
	'. + {claude_env: ($ENV | with_entries(select(.key | startswith("CLAUDE") or . == "TMUX" or . == "TMUX_PANE" or . == "HERDR_PANE_ID" or . == "HERDR_WORKSPACE_ID" or . == "HERDR_TAB_ID" or . == "HERDR_SOCKET_PATH" or . == "HERDR_SESSION" or . == "HERDR_ENV")))}';

function curlPost(port: number): string {
	// --connect-timeout 0.1 + `|| true` guarantee the hook never blocks Claude:
	// if the viewer isn't running the curl returns immediately and the shell
	// exits 0 regardless.
	return `jq -c '${HOOK_PAYLOAD_JQ_FILTER}' | curl -sX POST --connect-timeout 0.1 http://localhost:${port}/api/hook -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true`;
}

function curlContextBrief(port: number): string {
	// This response must reach hook stdout because Claude injects it as session
	// context. URL encoding preserves cwd paths containing spaces or punctuation.
	return `curl -s --get --connect-timeout 0.5 --data-urlencode "cwd=$(pwd)" "http://localhost:${port}/api/context-brief" 2>/dev/null || true`;
}

interface GenerateOptions {
	port?: number;
	includeContextBrief?: boolean;
}

export function generateHooksConfig(options?: GenerateOptions): HooksConfig {
	const port = options?.port ?? DEFAULT_HOOK_PORT;
	const hooks: Record<string, HookMatcher[]> = {};
	const command = curlPost(port);

	for (const eventName of HOOK_EVENT_NAMES) {
		hooks[eventName] = [
			{
				hooks: [
					{
						type: "command",
						command,
					},
				],
			},
		];
	}

	if (options?.includeContextBrief === true) {
		const sessionStartHooks = hooks["SessionStart"];
		if (!sessionStartHooks) {
			throw new Error("SessionStart must be a known hook event");
		}
		sessionStartHooks.push({
			matcher: "startup|resume",
			hooks: [
				{
					type: "command",
					command: curlContextBrief(port),
				},
			],
		});
	}

	return {hooks};
}

type InstallState = "current" | "outdated" | "missing";

/** The `command` strings of every hook under one event of a written settings.json. */
function installedCommands(entries: unknown): string[] {
	if (!Array.isArray(entries)) return [];
	return entries.flatMap((entry: unknown) => {
		const hooks = asRecord(entry)?.["hooks"];
		if (!Array.isArray(hooks)) return [];
		return hooks.flatMap((hook: unknown) => {
			const command = asRecord(hook)?.["command"];
			return typeof command === "string" ? [command] : [];
		});
	});
}

/**
 * How one event stands in an existing settings.json `hooks` block: `current`
 * when a matcher carries the exact command we would generate, `outdated` when a
 * command still POSTs to this server's `/api/hook` but was written by an older
 * build (a since-changed jq filter, say), and `missing` otherwise — hooks
 * pointed at another port, or another tool's script, are not ours.
 */
function eventInstallStates(
	installed: Record<string, unknown> | undefined,
	options?: GenerateOptions,
): [HookEventName, InstallState][] {
	const desired = generateHooksConfig(options);
	const hookUrl = new RegExp(`http://localhost:${options?.port ?? DEFAULT_HOOK_PORT}/api/hook(?![\\w/-])`);
	return HOOK_EVENT_NAMES.map((eventName) => {
		const desiredCommand = desired.hooks[eventName]?.[0]?.hooks[0]?.command;
		const commands = installedCommands(installed?.[eventName]);
		if (commands.includes(desiredCommand ?? "")) return [eventName, "current"];
		if (commands.some((command) => hookUrl.test(command))) return [eventName, "outdated"];
		return [eventName, "missing"];
	});
}

/**
 * Which hook events are absent from an existing settings.json `hooks` block.
 * Events installed by an older build still post here, so they are outdated
 * rather than missing. Pass `undefined` for a settings file that has no
 * `hooks` key at all; every event is then missing.
 *
 * Drives both the aggregate `/api/hooks/status` counts and the per-event copy
 * on pages fed by one specific event — `/notifications` is empty forever
 * without `Notification`, and says so.
 */
export function missingHookEvents(
	installed: Record<string, unknown> | undefined,
	options?: GenerateOptions,
): HookEventName[] {
	return eventInstallStates(installed, options)
		.filter(([, state]) => state === "missing")
		.map(([eventName]) => eventName);
}

export interface HookInstallStatus {
	/** Every event carries the exact command this build generates. */
	installed: boolean;
	/** Some events are absent while others are present (current or outdated). */
	partial: boolean;
	/** Events present in any form, current or outdated. */
	installedCount: number;
	totalCount: number;
	missingEvents: HookEventName[];
	/** Events that post to this server with a command from an older build. */
	outdatedEvents: HookEventName[];
}

/** The install summary behind `/api/hooks/status`, minus the settings path. */
export function hookInstallStatus(
	installed: Record<string, unknown> | undefined,
	options?: GenerateOptions,
): HookInstallStatus {
	const states = eventInstallStates(installed, options);
	const namesIn = (wanted: InstallState) =>
		states.filter(([, state]) => state === wanted).map(([eventName]) => eventName);
	const missingEvents = namesIn("missing");
	const outdatedEvents = namesIn("outdated");
	const installedCount = HOOK_EVENT_NAMES.length - missingEvents.length;
	return {
		installed: missingEvents.length === 0 && outdatedEvents.length === 0,
		partial: installedCount > 0 && missingEvents.length > 0,
		installedCount,
		totalCount: HOOK_EVENT_NAMES.length,
		missingEvents,
		outdatedEvents,
	};
}

/**
 * Return a pretty-printed JSON string of just the hooks block,
 * suitable for copying into ~/.claude/settings.json.
 */
export function generateHooksJson(options?: GenerateOptions): string {
	return JSON.stringify(generateHooksConfig(options), null, 2);
}
