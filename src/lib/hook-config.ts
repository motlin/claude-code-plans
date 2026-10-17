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
 * Events the server consumes whose hooks must never be installed: a configured
 * `WorktreeCreate` hook replaces git's own worktree creation (and fails it when
 * the hook prints no path), and a `WorktreeRemove` hook that exits 0 counts the
 * worktree as removed with no git fallback. A fire-and-forget forwarder would
 * break `--worktree` and `isolation: "worktree"` on both.
 */
export const NEVER_INSTALLED_HOOK_EVENTS: readonly HookEventName[] = ["WorktreeCreate", "WorktreeRemove"];

/**
 * The hook events the install helper writes to settings.json: every event the
 * receiver's `HookEventEnvelope` union handles, minus
 * {@link NEVER_INSTALLED_HOOK_EVENTS}.
 */
export const HOOK_EVENT_NAMES: readonly HookEventName[] = KNOWN_HOOK_EVENTS.filter(
	(eventName) => !NEVER_INSTALLED_HOOK_EVENTS.includes(eventName),
);

export interface HookFeature {
	id: string;
	label: string;
	/** Events the feature does nothing without. */
	required: readonly HookEventName[];
	/** Events that make the feature more precise but that it can live without. */
	optional: readonly HookEventName[];
}

/**
 * Which app feature each installed hook event feeds, so the helper can say
 * what a partial install leaves broken rather than only counting events.
 */
export const HOOK_FEATURES: readonly HookFeature[] = [
	{
		id: "liveSessions",
		label: "Live session status (active, working, waiting)",
		required: ["SessionStart", "SessionEnd", "Stop", "UserPromptSubmit"],
		optional: ["CwdChanged", "InstructionsLoaded", "ConfigChange"],
	},
	{
		id: "toolActivity",
		label: "Live tool activity and instant transcript updates",
		required: ["PreToolUse", "PostToolUse"],
		optional: ["PostToolUseFailure"],
	},
	{
		id: "questionsAndPermissions",
		label: "Answering questions and permission prompts from the browser",
		required: ["PreToolUse", "PostToolUse", "PermissionRequest"],
		optional: [],
	},
	{id: "notifications", label: "Notifications", required: ["Notification"], optional: []},
	{
		id: "terminalPanes",
		label: "Mapping sessions to tmux and herdr panes",
		required: ["SessionStart", "UserPromptSubmit"],
		optional: [],
	},
	{id: "subagents", label: "Background agent tracking", required: ["SubagentStart", "SubagentStop"], optional: []},
	{id: "compaction", label: "Compaction indicator", required: ["PreCompact", "PostCompact"], optional: []},
	{id: "tasks", label: "Instant task updates", required: ["TaskCreated", "TaskCompleted"], optional: []},
	{id: "streamingText", label: "Streaming assistant text", required: ["MessageDisplay"], optional: []},
];

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
/** Non-CLAUDE env vars forwarded by exact name, used to map a session to its terminal pane. */
const FORWARDED_ENV_NAMES = [
	"TMUX",
	"TMUX_PANE",
	"HERDR_PANE_ID",
	"HERDR_WORKSPACE_ID",
	"HERDR_TAB_ID",
	"HERDR_SOCKET_PATH",
	"HERDR_SESSION",
	"HERDR_ENV",
] as const;

export const HOOK_PAYLOAD_JQ_FILTER = `. + {claude_env: ($ENV | with_entries(select(.key | startswith("CLAUDE")${FORWARDED_ENV_NAMES.map((name) => ` or . == "${name}"`).join("")})))}`;

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

/** A command this helper wrote, on any port: the forwarder or the context brief. */
function isManagedCommand(command: string): boolean {
	return /http:\/\/localhost:\d+\/api\/(hook|context-brief)(?![\w/-])/.test(command);
}

const FORWARDER_PORT = /http:\/\/localhost:(\d+)\/api\/hook(?![\w/-])/;

/**
 * Remove this server's hook commands from one event's matcher list, keeping
 * every other tool's command, including one sharing a matcher with ours.
 * Matchers left with no hooks are dropped; entries that are not matcher
 * objects pass through untouched.
 */
export function removeManagedHooks(entries: readonly unknown[]): unknown[] {
	return entries.flatMap((entry) => {
		const record = asRecord(entry);
		const hooks = record?.["hooks"];
		if (record === undefined || !Array.isArray(hooks)) return [entry];
		const kept = hooks.filter((hook: unknown) => {
			const command = asRecord(hook)?.["command"];
			return typeof command !== "string" || !isManagedCommand(command);
		});
		if (kept.length === hooks.length) return [entry];
		return kept.length === 0 ? [] : [{...record, hooks: kept}];
	});
}

/** Why an installed forwarder differs from the one this build generates. */
function outdatedReasons(command: string, port: number): string[] {
	const reasons: string[] = [];
	const installedPort = Number(FORWARDER_PORT.exec(command)?.[1]);
	if (installedPort !== port) reasons.push(`posts to port ${installedPort}, not ${port}`);
	const unforwarded = FORWARDED_ENV_NAMES.filter((name) => !command.includes(`. == "${name}"`));
	if (unforwarded.length > 0) reasons.push(`does not forward ${unforwarded.join(", ")}`);
	return reasons.length > 0 ? reasons : ["differs from the command this server now generates"];
}

export interface HookEventStatus {
	event: HookEventName;
	/**
	 * `current` when a matcher carries the exact command we would generate,
	 * `outdated` when a command still POSTs to an `/api/hook` forwarder but was
	 * written by an older build or for another port, `missing` otherwise.
	 */
	state: InstallState;
	/** Why an outdated forwarder differs; empty unless `state` is `outdated`. */
	reasons: string[];
	/** Other tools' commands under this event, which install and uninstall leave alone. */
	foreignCommands: string[];
}

function eventStatuses(installed: Record<string, unknown> | undefined, options?: GenerateOptions): HookEventStatus[] {
	const port = options?.port ?? DEFAULT_HOOK_PORT;
	const desired = generateHooksConfig(options);
	return HOOK_EVENT_NAMES.map((eventName) => {
		const desiredCommand = desired.hooks[eventName]?.[0]?.hooks[0]?.command;
		const commands = installedCommands(installed?.[eventName]);
		const foreignCommands = commands.filter((command) => !isManagedCommand(command));
		const forwarder = commands.find((command) => FORWARDER_PORT.test(command));
		if (commands.includes(desiredCommand ?? ""))
			return {event: eventName, state: "current", reasons: [], foreignCommands};
		if (forwarder !== undefined)
			return {event: eventName, state: "outdated", reasons: outdatedReasons(forwarder, port), foreignCommands};
		return {event: eventName, state: "missing", reasons: [], foreignCommands};
	});
}

/** True when one of an event's commands is a forwarder posting to `port`, current or not. */
function forwardsTo(entries: unknown, port: number): boolean {
	return installedCommands(entries).some((command) => Number(FORWARDER_PORT.exec(command)?.[1]) === port);
}

/**
 * Which hook events are absent from an existing settings.json `hooks` block.
 * Events installed by an older build, or for another port, still carry our
 * forwarder, so they are outdated rather than missing. Pass `undefined` for a
 * settings file that has no `hooks` key at all; every event is then missing.
 *
 * Drives both the aggregate `/api/hooks/status` counts and the per-event copy
 * on pages fed by one specific event — `/notifications` is empty forever
 * without `Notification`, and says so.
 */
export function missingHookEvents(
	installed: Record<string, unknown> | undefined,
	options?: GenerateOptions,
): HookEventName[] {
	return eventStatuses(installed, options)
		.filter((status) => status.state === "missing")
		.map((status) => status.event);
}

export interface HookFeatureStatus {
	id: string;
	label: string;
	/** `on` with every event delivering, `partial` when only optional ones are not, `off` otherwise. */
	state: "on" | "partial" | "off";
	missingRequired: HookEventName[];
	missingOptional: HookEventName[];
}

export interface HookInstallStatus {
	/** Every event carries the exact command this build generates, and none is stray. */
	installed: boolean;
	/** Some events are absent while others are present (current or outdated). */
	partial: boolean;
	/** Events present in any form, current or outdated. */
	installedCount: number;
	totalCount: number;
	missingEvents: HookEventName[];
	/** Events that post to an `/api/hook` forwarder with a command from an older build or another port. */
	outdatedEvents: HookEventName[];
	/** {@link NEVER_INSTALLED_HOOK_EVENTS} carrying our forwarder, which install removes. */
	strayEvents: HookEventName[];
	events: HookEventStatus[];
	features: HookFeatureStatus[];
}

/** The install summary behind `/api/hooks/status`, minus the settings path. */
export function hookInstallStatus(
	installed: Record<string, unknown> | undefined,
	options?: GenerateOptions,
): HookInstallStatus {
	const port = options?.port ?? DEFAULT_HOOK_PORT;
	const events = eventStatuses(installed, options);
	const namesIn = (wanted: InstallState) =>
		events.filter((status) => status.state === wanted).map((status) => status.event);
	const missingEvents = namesIn("missing");
	const outdatedEvents = namesIn("outdated");
	const strayEvents = NEVER_INSTALLED_HOOK_EVENTS.filter((eventName) =>
		installedCommands(installed?.[eventName]).some(isManagedCommand),
	);
	const delivering = new Set(HOOK_EVENT_NAMES.filter((eventName) => forwardsTo(installed?.[eventName], port)));
	const features = HOOK_FEATURES.map((feature): HookFeatureStatus => {
		const missingRequired = feature.required.filter((eventName) => !delivering.has(eventName));
		const missingOptional = feature.optional.filter((eventName) => !delivering.has(eventName));
		const state = missingRequired.length > 0 ? "off" : missingOptional.length > 0 ? "partial" : "on";
		return {id: feature.id, label: feature.label, state, missingRequired, missingOptional};
	});
	const installedCount = HOOK_EVENT_NAMES.length - missingEvents.length;
	return {
		installed: missingEvents.length === 0 && outdatedEvents.length === 0 && strayEvents.length === 0,
		partial: installedCount > 0 && missingEvents.length > 0,
		installedCount,
		totalCount: HOOK_EVENT_NAMES.length,
		missingEvents,
		outdatedEvents,
		strayEvents,
		events,
		features,
	};
}

/**
 * Return a pretty-printed JSON string of just the hooks block,
 * suitable for copying into ~/.claude/settings.json.
 */
export function generateHooksJson(options?: GenerateOptions): string {
	return JSON.stringify(generateHooksConfig(options), null, 2);
}
