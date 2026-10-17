import {describe, expect, it} from "vite-plus/test";
import {
	generateHooksConfig,
	hookInstallStatus,
	missingHookEvents,
	removeManagedHooks,
	DEFAULT_HOOK_PORT,
	HOOK_EVENT_NAMES,
	HOOK_FEATURES,
	NEVER_INSTALLED_HOOK_EVENTS,
} from "../src/lib/hook-config";
import {KNOWN_HOOK_EVENTS} from "../src/lib/hook-events";

/**
 * Every hook event the Claude Code hooks reference lists (code.claude.com/docs/en/hooks,
 * checked 2026-10-17). Events here that the server does not consume yet are
 * tracked as follow-up work, not installed.
 */
const CLI_HOOK_EVENTS: ReadonlySet<string> = new Set([
	"SessionStart",
	"Setup",
	"UserPromptSubmit",
	"UserPromptExpansion",
	"PreToolUse",
	"PermissionRequest",
	"PermissionDenied",
	"PostToolUse",
	"PostToolUseFailure",
	"PostToolBatch",
	"Notification",
	"MessageDisplay",
	"SubagentStart",
	"SubagentStop",
	"TaskCreated",
	"TaskCompleted",
	"Stop",
	"StopFailure",
	"TeammateIdle",
	"InstructionsLoaded",
	"ConfigChange",
	"CwdChanged",
	"DirectoryAdded",
	"FileChanged",
	"WorktreeCreate",
	"WorktreeRemove",
	"PreCompact",
	"PostCompact",
	"PreModelSwitch",
	"PostModelSwitch",
	"Elicitation",
	"ElicitationResult",
	"SessionEnd",
]);

describe("HOOK_EVENT_NAMES", () => {
	it("contains all expected Claude hook event names", () => {
		expect(HOOK_EVENT_NAMES.toSorted()).toStrictEqual(
			[
				"SessionStart",
				"SessionEnd",
				"Stop",
				"SubagentStart",
				"SubagentStop",
				"UserPromptSubmit",
				"Notification",
				"PreCompact",
				"PostCompact",
				"PreToolUse",
				"PostToolUse",
				"PostToolUseFailure",
				"PermissionRequest",
				"TaskCreated",
				"TaskCompleted",
				"CwdChanged",
				"InstructionsLoaded",
				"ConfigChange",
				"MessageDisplay",
			].toSorted(),
		);
	});

	it("is every event the server consumes except the ones that must never be installed", () => {
		expect({
			installed: [...HOOK_EVENT_NAMES, ...NEVER_INSTALLED_HOOK_EVENTS].toSorted(),
			overlap: HOOK_EVENT_NAMES.filter((name) => NEVER_INSTALLED_HOOK_EVENTS.includes(name)),
		}).toStrictEqual({installed: [...KNOWN_HOOK_EVENTS].toSorted(), overlap: []});
	});

	it("never installs WorktreeCreate or WorktreeRemove, whose hooks replace git's own worktree handling", () => {
		expect([...NEVER_INSTALLED_HOOK_EVENTS]).toStrictEqual(["WorktreeCreate", "WorktreeRemove"]);
	});

	it("only consumes events the Claude Code CLI documents", () => {
		expect(KNOWN_HOOK_EVENTS.filter((name) => !CLI_HOOK_EVENTS.has(name))).toStrictEqual([]);
	});
});

describe("generateHooksConfig", () => {
	it("returns valid JSON object with hooks key", () => {
		const config = generateHooksConfig();
		expect(Object.keys(config)).toStrictEqual(["hooks"]);
		expect(typeof config.hooks).toBe("object");
	});

	it("uses default port", () => {
		const config = generateHooksConfig();
		const json = JSON.stringify(config);
		expect(json).toContain(`localhost:${DEFAULT_HOOK_PORT}`);
	});

	it("accepts a custom port", () => {
		const config = generateHooksConfig({port: 9000});
		const json = JSON.stringify(config);
		expect(json).toContain("localhost:9000");
		expect(json).not.toContain(`localhost:${DEFAULT_HOOK_PORT}`);
	});

	it("generates a hook entry for each supported event", () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, unknown>;
		expect(Object.keys(hooks).toSorted()).toStrictEqual(HOOK_EVENT_NAMES.toSorted());
	});

	it("each hook entry posts to /api/hook", () => {
		const config = generateHooksConfig();
		const json = JSON.stringify(config);
		expect(json).toContain("/api/hook");
	});

	it("uses the same command for every hook event (single forwarder)", () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, Array<{hooks: Array<{type: string; command: string}>}>>;
		const commands = HOOK_EVENT_NAMES.map((name) => hooks[name]![0]!.hooks[0]!.command);
		const unique = new Set(commands);
		expect(unique.size).toBe(1);
	});

	it("adds a separate stdout-preserving context hook for startup and resume", () => {
		const config = generateHooksConfig({includeContextBrief: true});
		expect(config.hooks["SessionStart"]?.[1]).toStrictEqual({
			matcher: "startup|resume",
			hooks: [
				{
					type: "command",
					command:
						'curl -s --get --connect-timeout 0.5 --data-urlencode "cwd=$(pwd)" "http://localhost:7526/api/context-brief" 2>/dev/null || true',
				},
			],
		});
	});

	it("leaves the optional context hook out by default", () => {
		expect(generateHooksConfig().hooks["SessionStart"]).toStrictEqual([
			{
				hooks: [
					{
						type: "command",
						command:
							'jq -c \'. + {claude_env: ($ENV | with_entries(select(.key | startswith("CLAUDE") or . == "TMUX" or . == "TMUX_PANE" or . == "HERDR_PANE_ID" or . == "HERDR_WORKSPACE_ID" or . == "HERDR_TAB_ID" or . == "HERDR_SOCKET_PATH" or . == "HERDR_SESSION" or . == "HERDR_ENV")))}\' | curl -sX POST --connect-timeout 0.1 http://localhost:7526/api/hook -H \'Content-Type: application/json\' --data-binary @- >/dev/null 2>&1 || true',
					},
				],
			},
		]);
	});

	it("forwards the full hook stdin payload via jq", () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, Array<{hooks: Array<{type: string; command: string}>}>>;
		const command = hooks["SessionStart"]![0]!.hooks[0]!.command;
		// Pipes stdin through jq, not `echo '{}' | jq`
		expect(command).toContain("jq -c");
		expect(command).not.toContain("echo '{}'");
		// Posts the jq output as the request body
		expect(command).toContain("--data-binary @-");
	});

	it("merges CLAUDE-prefixed env vars into claude_env on every event", () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, Array<{hooks: Array<{type: string; command: string}>}>>;
		for (const eventName of HOOK_EVENT_NAMES) {
			const command = hooks[eventName]![0]!.hooks[0]!.command;
			expect(command).toContain("claude_env");
			expect(command).toContain('startswith("CLAUDE")');
		}
	});

	it("produces valid JSON when stringified", () => {
		const config = generateHooksConfig();
		const json = JSON.stringify(config, null, 2);
		const parsed: unknown = JSON.parse(json);
		expect(parsed).toStrictEqual(config);
	});

	it("all hooks suppress errors with || true and use --connect-timeout to never block", () => {
		const config = generateHooksConfig();
		const hooks = config.hooks as Record<string, Array<{hooks: Array<{type: string; command: string}>}>>;
		for (const eventName of HOOK_EVENT_NAMES) {
			const command = hooks[eventName]![0]!.hooks[0]!.command;
			expect(command).toContain("|| true");
			expect(command).toContain("--connect-timeout 0.1");
		}
	});
});

describe("missingHookEvents", () => {
	it("reports every event as missing when settings.json has no hooks block", () => {
		expect(missingHookEvents(undefined)).toStrictEqual([...HOOK_EVENT_NAMES]);
	});

	it("reports no missing events for a full install", () => {
		expect(missingHookEvents(generateHooksConfig().hooks)).toStrictEqual([]);
	});

	it("names the events a partial install left out", () => {
		const {hooks} = generateHooksConfig();
		const partial: Record<string, unknown> = {
			SessionStart: hooks["SessionStart"],
			Stop: hooks["Stop"],
		};
		const missing = missingHookEvents(partial);
		expect({
			includesNotification: missing.includes("Notification"),
			includesInstalled: missing.includes("SessionStart") || missing.includes("Stop"),
			count: missing.length,
		}).toStrictEqual({
			includesNotification: true,
			includesInstalled: false,
			count: HOOK_EVENT_NAMES.length - 2,
		});
	});

	it("treats an unrelated command under a known event name as missing", () => {
		const foreign: Record<string, unknown> = {
			Notification: [{hooks: [{type: "command", command: "bash ~/.claude/hooks/other.sh"}]}],
		};
		expect(missingHookEvents(foreign).includes("Notification")).toBe(true);
	});

	it("treats hooks installed on a different port as outdated, not missing", () => {
		const otherPort = generateHooksConfig({port: 9000}).hooks;
		expect(missingHookEvents(otherPort)).toStrictEqual([]);
	});
});

/** A full install written by an older build, before `HERDR_SESSION` joined the forwarded env. */
function olderCommandInstall(): Record<string, unknown> {
	const {hooks} = generateHooksConfig();
	return JSON.parse(JSON.stringify(hooks).replaceAll(' or . == \\"HERDR_SESSION\\"', "")) as Record<string, unknown>;
}

describe("hookInstallStatus", () => {
	it("fixture: the older install really differs from the current command", () => {
		expect(JSON.stringify(olderCommandInstall()) === JSON.stringify(generateHooksConfig().hooks)).toBe(false);
	});

	it("reports a full current install as installed", () => {
		const {events: _events, features: _features, ...summary} = hookInstallStatus(generateHooksConfig().hooks);
		expect(summary).toStrictEqual({
			installed: true,
			partial: false,
			installedCount: HOOK_EVENT_NAMES.length,
			totalCount: HOOK_EVENT_NAMES.length,
			missingEvents: [],
			outdatedEvents: [],
			strayEvents: [],
		});
	});

	it("reports hooks posting to this server with an older command as outdated, not missing", () => {
		const {events: _events, features: _features, ...summary} = hookInstallStatus(olderCommandInstall());
		expect(summary).toStrictEqual({
			installed: false,
			partial: false,
			installedCount: HOOK_EVENT_NAMES.length,
			totalCount: HOOK_EVENT_NAMES.length,
			missingEvents: [],
			outdatedEvents: [...HOOK_EVENT_NAMES],
			strayEvents: [],
		});
	});

	it("separates outdated events from missing ones in a mixed install", () => {
		const older = olderCommandInstall();
		const {hooks} = generateHooksConfig();
		const mixed: Record<string, unknown> = {
			SessionStart: hooks["SessionStart"],
			Notification: older["Notification"],
		};
		const {events: _events, features: _features, ...summary} = hookInstallStatus(mixed);
		expect(summary).toStrictEqual({
			installed: false,
			partial: true,
			installedCount: 2,
			totalCount: HOOK_EVENT_NAMES.length,
			missingEvents: HOOK_EVENT_NAMES.filter((name) => name !== "SessionStart" && name !== "Notification"),
			outdatedEvents: ["Notification"],
			strayEvents: [],
		});
	});

	it("does not count the context-brief hook as an outdated install", () => {
		const brief: Record<string, unknown> = {
			SessionStart: [
				{hooks: [{type: "command", command: "curl -s http://localhost:7526/api/context-brief || true"}]},
			],
		};
		expect(hookInstallStatus(brief).outdatedEvents).toStrictEqual([]);
	});

	it("leaves outdated events out of missingHookEvents", () => {
		expect(missingHookEvents(olderCommandInstall())).toStrictEqual([]);
	});
});

const CURRENT_COMMAND = generateHooksConfig().hooks["Stop"]![0]!.hooks[0]!.command;
const HERDR_SCRIPT = "bash '/Users/test/.claude/hooks/herdr-agent-state.sh' session";

function commandHook(command: string) {
	return {hooks: [{type: "command", command}]};
}

/**
 * The layout found in a real settings.json on 2026-10-17: SessionStart runs only
 * herdr's own script, and seven events run a forwarder from before
 * `HERDR_SESSION` joined the forwarded env.
 */
function herdrPlusOlderSeven(): Record<string, unknown> {
	const older = CURRENT_COMMAND.replace(' or . == "HERDR_SESSION"', "");
	const events = [
		"PreToolUse",
		"PostToolUse",
		"PostToolUseFailure",
		"Stop",
		"SessionEnd",
		"PermissionRequest",
		"Notification",
	];
	return {
		SessionStart: [commandHook(HERDR_SCRIPT)],
		...Object.fromEntries(events.map((name) => [name, [commandHook(older)]])),
	};
}

describe("HOOK_FEATURES", () => {
	it("gives every installed event to at least one feature", () => {
		const covered = new Set(HOOK_FEATURES.flatMap((feature) => [...feature.required, ...feature.optional]));
		expect(HOOK_EVENT_NAMES.filter((name) => !covered.has(name))).toStrictEqual([]);
	});

	it("only names installed events, each once per feature", () => {
		expect(
			HOOK_FEATURES.flatMap((feature) => {
				const names = [...feature.required, ...feature.optional];
				const problems = names.filter((name) => !HOOK_EVENT_NAMES.includes(name));
				return new Set(names).size === names.length ? problems : [...problems, `${feature.id}: duplicate`];
			}),
		).toStrictEqual([]);
	});
});

describe("hookInstallStatus per-event detail", () => {
	it("explains why each outdated event is outdated and keeps other tools' hooks visible as foreign", () => {
		const status = hookInstallStatus(herdrPlusOlderSeven());
		expect(status.events.filter((event) => event.event === "SessionStart" || event.event === "Stop")).toStrictEqual(
			[
				{event: "SessionStart", state: "missing", reasons: [], foreignCommands: [HERDR_SCRIPT]},
				{event: "Stop", state: "outdated", reasons: ["does not forward HERDR_SESSION"], foreignCommands: []},
			],
		);
	});

	it("flags a forwarder on another port with the port it posts to", () => {
		const otherPort = generateHooksConfig({port: 9000}).hooks;
		expect(hookInstallStatus(otherPort).events.find((event) => event.event === "Stop")).toStrictEqual({
			event: "Stop",
			state: "outdated",
			reasons: ["posts to port 9000, not 7526"],
			foreignCommands: [],
		});
	});

	it("flags tmux forwarding dropped from an older command", () => {
		const noTmux = CURRENT_COMMAND.replace(' or . == "TMUX" or . == "TMUX_PANE"', "");
		expect(
			hookInstallStatus({Stop: [commandHook(noTmux)]}).events.find((e) => e.event === "Stop")?.reasons,
		).toStrictEqual(["does not forward TMUX, TMUX_PANE"]);
	});

	it("reports a forwarder installed under a never-installed event as stray", () => {
		const status = hookInstallStatus({
			...generateHooksConfig().hooks,
			WorktreeCreate: [commandHook(CURRENT_COMMAND)],
		});
		expect({installed: status.installed, strayEvents: status.strayEvents}).toStrictEqual({
			installed: false,
			strayEvents: ["WorktreeCreate"],
		});
	});

	it("ignores another tool's WorktreeCreate hook", () => {
		expect(
			hookInstallStatus({WorktreeCreate: [commandHook("bash ~/bin/make-worktree.sh")]}).strayEvents,
		).toStrictEqual([]);
	});
});

describe("hookInstallStatus per-feature state", () => {
	it("turns every feature off with no hooks installed", () => {
		expect(new Set(hookInstallStatus(undefined).features.map((feature) => feature.state))).toStrictEqual(
			new Set(["off"]),
		);
	});

	it("turns every feature on for a full current install", () => {
		expect(
			hookInstallStatus(generateHooksConfig().hooks).features.map((feature) => [feature.id, feature.state]),
		).toStrictEqual(HOOK_FEATURES.map((feature) => [feature.id, "on"]));
	});

	it("classifies the herdr-plus-older-seven layout feature by feature", () => {
		expect(
			hookInstallStatus(herdrPlusOlderSeven()).features.map(({id, state, missingRequired, missingOptional}) => ({
				id,
				state,
				missingRequired,
				missingOptional,
			})),
		).toStrictEqual([
			{
				id: "liveSessions",
				state: "off",
				missingRequired: ["SessionStart", "UserPromptSubmit"],
				missingOptional: ["CwdChanged", "InstructionsLoaded", "ConfigChange"],
			},
			{id: "toolActivity", state: "on", missingRequired: [], missingOptional: []},
			{id: "questionsAndPermissions", state: "on", missingRequired: [], missingOptional: []},
			{id: "notifications", state: "on", missingRequired: [], missingOptional: []},
			{
				id: "terminalPanes",
				state: "off",
				missingRequired: ["SessionStart", "UserPromptSubmit"],
				missingOptional: [],
			},
			{id: "subagents", state: "off", missingRequired: ["SubagentStart", "SubagentStop"], missingOptional: []},
			{id: "compaction", state: "off", missingRequired: ["PreCompact", "PostCompact"], missingOptional: []},
			{id: "tasks", state: "off", missingRequired: ["TaskCreated", "TaskCompleted"], missingOptional: []},
			{id: "streamingText", state: "off", missingRequired: ["MessageDisplay"], missingOptional: []},
		]);
	});

	it("calls a feature partial when only optional events are missing", () => {
		const {hooks} = generateHooksConfig();
		const {CwdChanged: _cwd, ...withoutCwd} = hooks;
		expect(hookInstallStatus(withoutCwd).features.find((feature) => feature.id === "liveSessions")).toStrictEqual({
			id: "liveSessions",
			label: HOOK_FEATURES.find((feature) => feature.id === "liveSessions")?.label,
			state: "partial",
			missingRequired: [],
			missingOptional: ["CwdChanged"],
		});
	});

	it("does not count hooks posting to another port toward any feature", () => {
		expect(
			new Set(
				hookInstallStatus(generateHooksConfig({port: 9000}).hooks).features.map((feature) => feature.state),
			),
		).toStrictEqual(new Set(["off"]));
	});
});

describe("removeManagedHooks", () => {
	it("removes only this server's commands, keeping a foreign hook that shares the matcher", () => {
		expect(
			removeManagedHooks([
				{
					hooks: [
						{type: "command", command: CURRENT_COMMAND},
						{type: "command", command: HERDR_SCRIPT},
					],
				},
				commandHook("curl -s http://localhost:7526/api/context-brief || true"),
				{matcher: "Bash", hooks: [{type: "command", command: "echo mine"}]},
			]),
		).toStrictEqual([
			{hooks: [{type: "command", command: HERDR_SCRIPT}]},
			{matcher: "Bash", hooks: [{type: "command", command: "echo mine"}]},
		]);
	});

	it("passes through entries it does not understand", () => {
		expect(removeManagedHooks(["odd", {matcher: "x"}])).toStrictEqual(["odd", {matcher: "x"}]);
	});
});
