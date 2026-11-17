import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {SlashCommandListResponse} from "../src/lib/api/commands";
import
{
	autocompactCommand,
	fastCommandArg,
	parseCommandShape,
	parseHostCommand,
	routeStatusCommand,
	routeUsageCommand,
} from "../src/lib/composer-host-commands";
import {isBareAdvisorCommand} from "../src/lib/advisor";
import {parseBtwCommand} from "../src/lib/side-chat";
import
{
	BUILTIN_SLASH_COMMANDS,
	CLI_COMMAND_NAMES,
	cliTwinCommands,
	SESSION_SLASH_COMMANDS,
	filterSlashCommands,
	highlightMatches,
	isKnownSlashCommand,
	mergeSlashCommands,
	skillChipArgumentHint,
	slashCommandLabel,
	slashTrigger,
	splitLeadingSlashCommand,
	type SlashCommand,
} from "../src/lib/slash-commands";
import {listSlashCommands} from "../src/lib/slash-commands.server";

function write(file: string, content: string): void
{
	mkdirSync(
		dirname(file),
		{
			recursive: true,
		},
	);
	writeFileSync(file, content);
}

describe("SESSION_SLASH_COMMANDS", () =>
{
	it("holds the built-ins upstream offers only inside a session, which /api/commands leaves out", () =>
	{
		expect(
			{
				session: SESSION_SLASH_COMMANDS,
				inBuiltins: BUILTIN_SLASH_COMMANDS.some((c) =>
					SESSION_SLASH_COMMANDS.some((session) => session.name === c.name),
				),
				knowsAutocompact: isKnownSlashCommand("autocompact", SESSION_SLASH_COMMANDS),
			},
		).toStrictEqual(
			{
				session: [
					{
						name: "rewind",
						description: "Rewind the session to an earlier message",
						source: "builtin",
						hostHandled: true,
					},
					{
						name: "autocompact",
						description: "Show context usage or set when auto-compact runs",
						source: "builtin",
						argumentHint: "[auto|<tokens>]",
						hostHandled: true,
					},
					{
						name: "status",
						description: "Show this session’s version, model, environment, and account",
						source: "builtin",
						hostHandled: true,
					},
					{
						name: "advisor",
						description: "Let Claude consult a stronger model at key moments",
						source: "builtin",
						argumentHint: "[fable|opus|sonnet|off]",
						hostHandled: true,
					},
				],
				inBuiltins: false,
				knowsAutocompact: true,
			},
		);
	});
});

describe("BUILTIN_SLASH_COMMANDS", () =>
{
	it("uses upstream's strings, hints and aliases, then the local-only built-ins", () =>
	{
		expect(BUILTIN_SLASH_COMMANDS).toStrictEqual([
			{
				name: "model",
				description: "Set the model for this session",
				source: "builtin",
				argumentHint: "[model-id]",
				hostHandled: true,
			},
			{
				name: "effort",
				description: "Set the effort level for this session",
				source: "builtin",
				argumentHint: "[level]",
				hostHandled: true,
			},
			{
				name: "fast",
				description: "Turn fast mode on or off",
				source: "builtin",
				argumentHint: "[on|off]",
				hostHandled: true,
			},
			{
				name: "plan",
				description: "Switch to plan mode or view this session’s plan",
				source: "builtin",
				argumentHint: "[open|<description>]",
			},
			{
				name: "permissions",
				description: "Change the permission mode",
				source: "builtin",
				aliases: ["allowed-tools"],
				hostHandled: true,
			},
			{
				name: "skills",
				description: "Browse and manage your skills",
				source: "builtin",
			},
			{
				name: "workflows",
				description: "Browse workflow history (running and completed)",
				source: "builtin",
				aliases: ["workflow"],
				hostHandled: true,
			},
			{
				name: "usage",
				description: "Show plan usage and rate limits",
				source: "builtin",
				aliases: ["stats", "cost"],
				hostHandled: true,
			},
			{
				name: "config",
				description: "Open Claude Code settings",
				source: "builtin",
				aliases: ["settings"],
			},
			{
				name: "theme",
				description: "Set the appearance (system, light, or dark)",
				source: "builtin",
				argumentHint: "[system|light|dark]",
			},
			{
				name: "help",
				description: "Get help and support",
				source: "builtin",
			},
			{
				name: "btw",
				description: "Ask a quick side question without adding to the session",
				source: "builtin",
				argumentHint: "<question>",
				hostHandled: true,
			},
			{
				name: "rename",
				description: "Rename this session",
				source: "builtin",
				argumentHint: "[name]",
			},
			{
				name: "compact",
				description: "Free up context by summarizing the session so far",
				source: "builtin",
				argumentHint: "<optional custom summarization instructions>",
			},
			{
				name: "clear",
				description: "Start a new session with empty context",
				source: "builtin",
			},
			{
				name: "context",
				description: "Show current context usage",
				source: "builtin",
			},
			{
				name: "recap",
				description: "Generate a one-line session recap",
				source: "builtin",
			},
			{
				name: "review",
				description: "Review the current diff or a PR for bugs and cleanups",
				source: "builtin",
				argumentHint: "[low|medium|high|xhigh|max] [--fix] [--comment] [<pr#>|<branch>|<path>]",
			},
			{
				name: "init",
				description: "Initialize a new CLAUDE.md file with codebase documentation",
				source: "builtin",
			},
		]);
	});
});

describe("hostHandled built-ins", () =>
{
	it("are exactly the names and aliases the composer intercepts", () =>
	{
		const intercepted = (text: string): boolean =>
			parseHostCommand(
				text,
				{
					effortLevels: ["high"],
					models: [],
					menusAvailable: true,
				},
			) !== null ||
			fastCommandArg(text) !== null ||
			autocompactCommand(text) !== null ||
			parseBtwCommand(text) !== null ||
			routeStatusCommand(
				text,
				{
					hasSession: true,
					turnActive: false,
				},
			) !== null ||
			routeUsageCommand(
				text,
				{
					hasSession: true,
					turnActive: false,
				},
			) !== null ||
			isBareAdvisorCommand(text) ||
			parseCommandShape(["rewind", "workflows", "workflow"], text) !== null;
		const builtins = [...BUILTIN_SLASH_COMMANDS, ...SESSION_SLASH_COMMANDS];
		const labels = (commands: readonly SlashCommand[]) =>
			commands.flatMap((command) => [command.name, ...(command.aliases ?? [])]);

		expect(
			{
				hostHandledNotIntercepted: labels(builtins.filter((c) => c.hostHandled === true)).filter(
					(name) => !intercepted(`/${name}`),
				),
				interceptedNotHostHandled: labels(builtins.filter((c) => c.hostHandled !== true)).filter((name) =>
					intercepted(`/${name}`),
				),
			},
		).toStrictEqual(
			{
				// Upstream's /usage alias; the local /usage route answers only usage and cost, so /stats reaches the CLI.
				hostHandledNotIntercepted: ["stats"],
				interceptedNotHostHandled: [],
			},
		);
	});
});

describe("mergeSlashCommands", () =>
{
	it("keeps the first command for each name, in group order, and drops a custom twin of a host row that hides CLI rows", () =>
	{
		const merged = mergeSlashCommands([
			[
				{
					name: "model",
					description: "Built-in model",
					source: "builtin",
					hostHandled: true,
				},
			],
			[
				{
					name: "deploy",
					description: "Personal deploy",
					source: "personal-skill",
				},
				{
					name: "model",
					description: "Shadowed model",
					source: "personal-skill",
				},
			],
			[
				{
					name: "deploy",
					description: "Project deploy",
					source: "project-command",
				},
			],
			[
				{
					name: "tools:lint",
					description: "Lint",
					source: "plugin-skill",
				},
			],
		]);

		expect(merged).toStrictEqual([
			{
				name: "model",
				description: "Built-in model",
				source: "builtin",
				hostHandled: true,
			},
			{
				name: "deploy",
				description: "Personal deploy",
				source: "personal-skill",
			},
			{
				name: "tools:lint",
				description: "Lint",
				source: "plugin-skill",
			},
		]);
	});
});

describe("mergeSlashCommands with built-in collisions", () =>
{
	it("twins only host-handled built-ins; a custom entry replaces a pass-through built-in in place", () =>
	{
		const merged = mergeSlashCommands([
			[
				{
					name: "review",
					description: "Built-in review",
					source: "builtin",
				},
				{
					name: "config",
					description: "Built-in config",
					source: "builtin",
					aliases: ["settings"],
				},
				{
					name: "effort",
					description: "Built-in effort",
					source: "builtin",
					hostHandled: true,
				},
				{
					name: "workflows",
					description: "Built-in workflows",
					source: "builtin",
					aliases: ["workflow"],
					hostHandled: true,
				},
			],
			[
				{
					name: "review",
					description: "Skill review",
					source: "personal-skill",
				},
				{
					name: "tab-color",
					description: "Color the tab",
					source: "personal-skill",
				},
			],
			[
				{
					name: "review",
					description: "Command review",
					source: "personal-command",
				},
				{
					name: "settings",
					description: "My settings",
					source: "personal-command",
				},
				{
					name: "effort",
					description: "My effort",
					source: "personal-command",
				},
				{
					name: "workflow",
					description: "My workflow",
					source: "personal-command",
				},
			],
		]);

		expect(merged).toStrictEqual([
			{
				name: "review",
				description: "Skill review",
				source: "personal-skill",
			},
			{
				name: "config",
				description: "Built-in config",
				source: "builtin",
				aliases: ["settings"],
			},
			{
				name: "effort",
				description: "Built-in effort",
				source: "builtin",
				hostHandled: true,
			},
			{
				name: "workflows",
				description: "Built-in workflows",
				source: "builtin",
				aliases: ["workflow"],
				hostHandled: true,
			},
			{
				name: "tab-color",
				description: "Color the tab",
				source: "personal-skill",
			},
			{
				name: "settings",
				description: "My settings",
				source: "personal-command",
			},
			{
				name: "effort",
				description: "My effort",
				source: "personal-command",
				shadowsHost: true,
			},
			{
				name: "workflow",
				description: "My workflow",
				source: "personal-command",
				shadowsHost: true,
			},
		]);
	});

	it("twins a custom rewind only where the session's host-handled rewind is merged in", () =>
	{
		const custom: SlashCommand =
		{
			name: "rewind",
			description: "Mine",
			source: "project-skill",
		};

		expect(
			{
				session: mergeSlashCommands([SESSION_SLASH_COMMANDS, [custom]]).filter((c) => c.name === "rewind"),
				home: mergeSlashCommands([[], [custom]]),
			},
		).toStrictEqual(
			{
				session: [
					{
						name: "rewind",
						description: "Rewind the session to an earlier message",
						source: "builtin",
						hostHandled: true,
					},
					{
						name: "rewind",
						description: "Mine",
						source: "project-skill",
						shadowsHost: true,
					},
				],
				home: [custom],
			},
		);
	});

	it("lists the CLI's own autocompact as a twin after the host row, plain without it, and yields to a custom twin", () =>
	{
		const host: SlashCommand =
		{
			name: "autocompact",
			description: "Show context usage or set when auto-compact runs",
			source: "builtin",
			argumentHint: "[auto|<tokens>]",
			hostHandled: true,
		};
		const custom: SlashCommand =
		{
			name: "autocompact",
			description: "Mine",
			source: "personal-command",
		};

		const twins = cliTwinCommands(
			[host],
			{
				effortLevels: [],
				fastListed: true,
			},
		);

		expect(
			{
				twin: mergeSlashCommands([[host], [], twins]),
				noHost: mergeSlashCommands([[], twins]),
				custom: mergeSlashCommands([[host], [custom], twins]),
			},
		).toStrictEqual(
			{
				twin: [
					host,
					{
						name: "autocompact",
						description: "Set how full the context gets before auto-summarizing",
						source: "builtin",
						argumentHint: "[auto|<tokens>]",
						shadowsHost: true,
					},
				],
				noHost: [
					{
						name: "autocompact",
						description: "Set how full the context gets before auto-summarizing",
						source: "builtin",
						argumentHint: "[auto|<tokens>]",
					},
				],
				custom: [
					host,
					{
						name: "autocompact",
						description: "Mine",
						source: "personal-command",
						shadowsHost: true,
					},
				],
			},
		);
	});

	it("lets a custom rename replace the pass-through built-in rename", () =>
	{
		const renames = mergeSlashCommands([
			BUILTIN_SLASH_COMMANDS,
			[
				{
					name: "rename",
					description: "Mine",
					source: "personal-command",
				},
			],
		]).filter((c) => c.name === "rename");

		expect(renames).toStrictEqual([
			{
				name: "rename",
				description: "Mine",
				source: "personal-command",
			},
		]);
	});
});

describe("listSlashCommands", () =>
{
	let root: string;
	let claudeDir: string;
	let cwd: string;
	let pluginPath: string;

	beforeEach(() =>
	{
		root = mkdtempSync(join(tmpdir(), "slash-commands-"));
		claudeDir = join(root, "claude");
		cwd = join(root, "repos", "my-app");
		pluginPath = join(root, "plugin-cache", "tools", "1.0.0");
		mkdirSync(
			claudeDir,
			{
				recursive: true,
			},
		);
	});

	afterEach(() =>
	{
		rmSync(
			root,
			{
				recursive: true,
				force: true,
			},
		);
	});

	it("merges built-ins, skills, commands and plugin entries with skills shadowing commands", async () =>
	{
		write(
			join(claudeDir, "skills", "deploy", "SKILL.md"),
			'---\nname: deploy\ndescription: Personal deploy skill\nargument-hint: "[env]"\n---\n',
		);
		write(
			join(claudeDir, "skills", "hidden", "SKILL.md"),
			"---\nname: hidden\ndescription: Model only\nuser-invocable: false\n---\n",
		);
		write(join(claudeDir, "skills", "off", "SKILL.md"), "---\nname: off\ndescription: Disabled\n---\n");
		write(
			join(claudeDir, "settings.json"),
			JSON.stringify(
				{
					skillOverrides:
					{
						off: "off",
					},
				},
			),
		);
		write(
			join(cwd, ".claude", "skills", "deploy", "SKILL.md"),
			"---\nname: deploy\ndescription: Project deploy skill\n---\n",
		);
		write(
			join(cwd, ".claude", "skills", "release", "SKILL.md"),
			"---\nname: release\ndescription: Cut a release\n---\n",
		);
		write(
			join(claudeDir, "commands", "standup.md"),
			"---\ndescription: Write my standup\nargument-hint: [date]\n---\nBody",
		);
		write(join(claudeDir, "commands", "release.md"), "---\ndescription: Shadowed\n---\n");
		write(join(claudeDir, "commands", "model.md"), "---\ndescription: My model command\n---\n");
		write(join(claudeDir, "commands", "notes.txt"), "not a command");
		write(join(cwd, ".claude", "commands", "triage.md"), "Triage the open issues\n\nMore");
		write(join(cwd, ".claude", "commands", "standup.md"), "---\ndescription: Shadowed\n---\n");
		write(join(pluginPath, "skills", "lint", "SKILL.md"), "---\nname: lint\ndescription: Lint code\n---\n");
		write(
			join(pluginPath, "commands", "fix.md"),
			"---\ndescription: Fix lint errors\nargument-hint: <path>\n---\n",
		);
		write(
			join(claudeDir, "plugins", "installed_plugins.json"),
			JSON.stringify(
				{
					version: 2,
					plugins:
					{
						"tools@market": [
							{
								scope: "user",
								installPath: pluginPath,
								version: "1.0.0",
								installedAt: "2026-04-22T19:16:18.255Z",
								lastUpdated: "2026-04-22T19:16:18.255Z",
							},
						],
					},
				},
			),
		);

		const commands = await listSlashCommands(
			{
				claudeDir,
				cwd,
			},
		);

		expect(SlashCommandListResponse.parse(commands)).toStrictEqual([
			...BUILTIN_SLASH_COMMANDS,
			{
				name: "deploy",
				description: "Personal deploy skill",
				source: "personal-skill",
				argumentHint: "[env]",
			},
			{
				name: "release",
				description: "Cut a release",
				source: "project-skill",
			},
			{
				name: "standup",
				description: "Write my standup",
				source: "personal-command",
				argumentHint: "[date]",
			},
			{
				name: "triage",
				description: "Triage the open issues",
				source: "project-command",
			},
			{
				name: "tools:lint",
				description: "Lint code",
				source: "plugin-skill",
				pluginName: "tools",
			},
			{
				name: "tools:fix",
				description: "Fix lint errors",
				source: "plugin-command",
				argumentHint: "<path>",
				pluginName: "tools",
			},
		]);
	});

	it("lists only personal and plugin entries without a cwd", async () =>
	{
		write(join(claudeDir, "commands", "standup.md"), "---\ndescription: Write my standup\n---\n");

		expect(
			await listSlashCommands(
				{
					claudeDir,
					cwd: undefined,
				},
			),
		).toStrictEqual([
			...BUILTIN_SLASH_COMMANDS,
			{
				name: "standup",
				description: "Write my standup",
				source: "personal-command",
			},
		]);
	});
});

const COMMANDS: SlashCommand[] = [
	{
		name: "model",
		description: "Set the model for this session",
		source: "builtin",
	},
	{
		name: "plan",
		description: "Plan before coding",
		source: "builtin",
	},
	{
		name: "compact",
		description: "Summarize the conversation",
		source: "builtin",
	},
	{
		name: "git:commit",
		description: "Commit local changes",
		source: "plugin-skill",
	},
	{
		name: "autocompact",
		description: "Custom compaction",
		source: "personal-command",
	},
];

describe("filterSlashCommands", () =>
{
	it("lists every command in list order for an empty query", () =>
	{
		expect(filterSlashCommands(COMMANDS, "").map((c) => c.name)).toStrictEqual([
			"model",
			"plan",
			"compact",
			"git:commit",
			"autocompact",
		]);
	});

	it("ranks name prefix over name contains over description matches, case-insensitively", () =>
	{
		expect(filterSlashCommands(COMMANDS, "CO").map((c) => c.name)).toStrictEqual([
			"compact",
			"git:commit",
			"autocompact",
			"plan",
		]);
	});

	it("returns nothing when no name or description matches", () =>
	{
		expect(filterSlashCommands(COMMANDS, "zzz")).toStrictEqual([]);
	});

	it("ranks the trimmed head while only whitespace follows it, and closes on an argument or an exact head (upstream spaceEndsCommand)", () =>
	{
		const cmds: SlashCommand[] = [
			...COMMANDS,
			{
				name: "config",
				description: "",
				source: "builtin",
				aliases: ["settings"],
			},
		];
		const withPluginLabel: SlashCommand[] = [
			...cmds,
			{
				name: "git:commit",
				pluginName: "git",
				description: "",
				source: "plugin-skill",
			},
		];
		const names = (list: readonly SlashCommand[], query: string) =>
			filterSlashCommands(list, query).map((c) => c.name);
		expect(
			{
				trailing: names(cmds, "mo "),
				trailingRun: names(cmds, "mo   "),
				exactName: names(cmds, "model "),
				exactAlias: names(cmds, "settings "),
				argument: names(cmds, "mo x"),
				exactPluginName: names(cmds, "git:commit "),
				exactPluginLabel: names(withPluginLabel, "commit "),
				tooLong: names(cmds, `${"x".repeat(48)}   `),
			},
		).toStrictEqual(
			{
				trailing: ["model"],
				trailingRun: ["model"],
				exactName: [],
				exactAlias: [],
				argument: [],
				exactPluginName: [],
				exactPluginLabel: [],
				tooLong: [],
			},
		);
	});

	it("ranks upstream's tiers: exact name, exact alias, name prefix, alias prefix, contains, then description", () =>
	{
		const commands: SlashCommand[] = [
			{
				name: "described",
				description: "Mentions set in prose",
				source: "builtin",
			},
			{
				name: "reset",
				description: "",
				source: "builtin",
			},
			{
				name: "theme",
				description: "",
				source: "builtin",
				aliases: ["colorset"],
			},
			{
				name: "config",
				description: "",
				source: "builtin",
				aliases: ["settings"],
			},
			{
				name: "setup",
				description: "",
				source: "builtin",
			},
			{
				name: "permissions",
				description: "",
				source: "builtin",
				aliases: ["set"],
			},
			{
				name: "set",
				description: "",
				source: "builtin",
			},
		];

		expect(filterSlashCommands(commands, "Set").map((c) => c.name)).toStrictEqual([
			"set",
			"permissions",
			"setup",
			"config",
			"reset",
			"theme",
			"described",
		]);
	});

	it("puts config first for its settings alias", () =>
	{
		const commands: SlashCommand[] = [
			{
				name: "plugin-dev:plugin-settings",
				description: "",
				source: "plugin-skill",
			},
			{
				name: "config",
				description: "Open Claude Code settings",
				source: "builtin",
				aliases: ["settings"],
			},
		];

		expect(filterSlashCommands(commands, "settings").map((c) => c.name)).toStrictEqual([
			"config",
			"plugin-dev:plugin-settings",
		]);
	});

	it("finds permissions among the built-ins by its allowed-tools alias prefix", () =>
	{
		expect(filterSlashCommands(BUILTIN_SLASH_COMMANDS, "allowed").map((c) => c.name)).toStrictEqual([
			"permissions",
		]);
	});

	it("returns nothing for a query over 50 characters", () =>
	{
		const commands: SlashCommand[] = [
			{
				name: "a".repeat(51),
				description: "",
				source: "builtin",
			},
		];

		expect(
			{
				fifty: filterSlashCommands(commands, "a".repeat(50)).length,
				fiftyOne: filterSlashCommands(commands, "a".repeat(51)),
			},
		).toStrictEqual(
			{
				fifty: 1,
				fiftyOne: [],
			},
		);
	});
});

describe("plugin skills", () =>
{
	const devServer: SlashCommand =
	{
		name: "build:dev-server",
		description: "Start a dev server",
		source: "plugin-skill",
		pluginName: "build",
	};
	const commands: SlashCommand[] = [
		{
			name: "redevelop",
			description: "",
			source: "builtin",
		},
		devServer,
		{
			name: "build",
			description: "",
			source: "builtin",
		},
	];

	it("labels a plugin skill by its bare name and leaves other commands unchanged", () =>
	{
		expect(
			{
				plugin: slashCommandLabel(devServer),
				builtin: slashCommandLabel(
					{
						name: "model",
						description: "",
						source: "builtin",
					},
				),
				unprefixed: slashCommandLabel(
					{
						...devServer,
						name: "dev-server",
					},
				),
			},
		).toStrictEqual(
			{
				plugin: "dev-server",
				builtin: "model",
				unprefixed: "dev-server",
			},
		);
	});

	it("ranks the bare label as the name and still matches plugin:name queries", () =>
	{
		expect(
			{
				dev: filterSlashCommands(commands, "dev").map((c) => c.name),
				exact: filterSlashCommands(commands, "dev-server").map((c) => c.name),
				namespaced: filterSlashCommands(commands, "build:dev").map((c) => c.name),
			},
		).toStrictEqual(
			{
				dev: ["build:dev-server", "redevelop"],
				exact: ["build:dev-server"],
				namespaced: ["build:dev-server"],
			},
		);
	});
});

describe("highlightMatches", () =>
{
	it("bolds the trimmed query, as upstream's menu context trims resetKey", () =>
	{
		expect(highlightMatches("model", "mo ")).toStrictEqual([
			{
				text: "mo",
				match: true,
			},
			{
				text: "del",
				match: false,
			},
		]);
	});

	it("bolds only the first case-insensitive match", () =>
	{
		expect([
			highlightMatches("status", "s"),
			highlightMatches("Browse and manage your skills", "s"),
			highlightMatches("Autocompact compaction", "COMP"),
		]).toStrictEqual([
			[
				{
					text: "s",
					match: true,
				},
				{
					text: "tatus",
					match: false,
				},
			],
			[
				{
					text: "Brow",
					match: false,
				},
				{
					text: "s",
					match: true,
				},
				{
					text: "e and manage your skills",
					match: false,
				},
			],
			[
				{
					text: "Auto",
					match: false,
				},
				{
					text: "comp",
					match: true,
				},
				{
					text: "act compaction",
					match: false,
				},
			],
		]);
	});

	it("returns the whole text unmatched when the query does not occur", () =>
	{
		expect(highlightMatches("model", "zz")).toStrictEqual([
			{
				text: "model",
				match: false,
			},
		]);
	});

	it("returns the whole text unmatched for an empty query", () =>
	{
		expect(highlightMatches("model", "")).toStrictEqual([
			{
				text: "model",
				match: false,
			},
		]);
	});
});

describe("slashTrigger", () =>
{
	const at = (prompt: string) => slashTrigger(prompt, prompt.length);

	it("opens selected at the start of the prompt while the first token is being typed", () =>
	{
		expect([at("/"), at("/mo"), at("/model "), at("/mo/"), slashTrigger("/mo\nnext", 3)]).toStrictEqual([
			{
				start: 0,
				query: "",
				atStart: true,
			},
			{
				start: 0,
				query: "mo",
				atStart: true,
			},
			{
				start: 0,
				query: "model ",
				atStart: true,
			},
			null,
			{
				start: 0,
				query: "mo",
				atStart: true,
			},
		]);
	});

	it("keeps spaces in the query as upstream's allowSpaces trigger does, stopping before a later ` /`", () =>
	{
		expect([
			at("/mo "),
			at("/mo   "),
			at("/mo x"),
			at("hello /mo "),
			at("/mo /pl"),
			at("/ "),
			at("/ mo"),
			at("/mo\n"),
			slashTrigger("/mo x", 3),
		]).toStrictEqual([
			{
				start: 0,
				query: "mo ",
				atStart: true,
			},
			{
				start: 0,
				query: "mo   ",
				atStart: true,
			},
			{
				start: 0,
				query: "mo x",
				atStart: true,
			},
			{
				start: 6,
				query: "mo ",
				atStart: false,
			},
			{
				start: 4,
				query: "pl",
				atStart: false,
			},
			null,
			null,
			null,
			{
				start: 0,
				query: "mo",
				atStart: true,
			},
		]);
	});

	it("opens mid-message only when the query starts with a letter, number or underscore (upstream midMessageNeedsName)", () =>
	{
		expect([
			at("hi /-"),
			at("hi /-x"),
			at("hi /."),
			at("hi /("),
			at("hi /😀"),
			at("line one\n/-"),
			at("hi /é"),
			at("hi /Ж"),
			at("hi /_x"),
			at("hi /1"),
			at("hi /mo"),
		]).toStrictEqual([
			null,
			null,
			null,
			null,
			null,
			null,
			{
				start: 3,
				query: "é",
				atStart: false,
			},
			{
				start: 3,
				query: "Ж",
				atStart: false,
			},
			{
				start: 3,
				query: "_x",
				atStart: false,
			},
			{
				start: 3,
				query: "1",
				atStart: false,
			},
			{
				start: 3,
				query: "mo",
				atStart: false,
			},
		]);
	});

	it("opens on any query at message start, which ignores leading whitespace and blank lines (upstream Pl/$5)", () =>
	{
		expect([at("/-"), at("/."), at("  /"), at("  /-"), at("  /mo"), at("\n/"), at("\n\n/mo")]).toStrictEqual([
			{
				start: 0,
				query: "-",
				atStart: true,
			},
			{
				start: 0,
				query: ".",
				atStart: true,
			},
			{
				start: 2,
				query: "",
				atStart: true,
			},
			{
				start: 2,
				query: "-",
				atStart: true,
			},
			{
				start: 2,
				query: "mo",
				atStart: true,
			},
			{
				start: 1,
				query: "",
				atStart: true,
			},
			{
				start: 2,
				query: "mo",
				atStart: true,
			},
		]);
	});

	it("opens only after a plain space or a line start (tiptap allowedPrefixes)", () =>
	{
		expect([at("hi\u00a0/mo"), at("hi\t/mo"), at("hi /mo")]).toStrictEqual([
			null,
			null,
			{
				start: 3,
				query: "mo",
				atStart: false,
			},
		]);
	});

	it("opens unselected after text or at the start of a later line, but not for an empty mid-line query", () =>
	{
		expect([
			at("hello /mo"),
			at("line one\n/ef"),
			at("hello /"),
			at("x/"),
			slashTrigger("hello /mo there", 9),
			slashTrigger("hello /model", 9),
		]).toStrictEqual([
			{
				start: 6,
				query: "mo",
				atStart: false,
			},
			{
				start: 9,
				query: "ef",
				atStart: false,
			},
			null,
			null,
			{
				start: 6,
				query: "mo",
				atStart: false,
			},
			null,
		]);
	});
});

describe("skillChipArgumentHint", () =>
{
	it("shows an accepted chip's argument hint while only whitespace follows it", () =>
	{
		const chip =
		{
			name: "model",
			argumentHint: "[model]",
		};
		expect([
			skillChipArgumentHint(chip, "/model "),
			skillChipArgumentHint(chip, "/model   "),
			skillChipArgumentHint(chip, "/model \n"),
			skillChipArgumentHint(chip, "/model\t"),
		]).toStrictEqual(["[model]", "[model]", "[model]", "[model]"]);
	});

	it("hides the hint with no separator, typed arguments, a long prompt or no hint", () =>
	{
		const chip =
		{
			name: "model",
			argumentHint: "[model]",
		};
		expect([
			skillChipArgumentHint(chip, "/model"),
			skillChipArgumentHint(chip, "/model x"),
			skillChipArgumentHint(chip, "/modelx "),
			skillChipArgumentHint(chip, "/model\n"),
			skillChipArgumentHint(chip, `/model ${" ".repeat(122)}`),
			skillChipArgumentHint(chip, `/model ${" ".repeat(121)}`),
			skillChipArgumentHint(
				{
					name: "model",
					argumentHint: undefined,
				},
				"/model ",
			),
			skillChipArgumentHint(
				{
					name: "model",
					argumentHint: "",
				},
				"/model ",
			),
		]).toStrictEqual([null, null, null, null, null, "[model]", null, null]);
	});
});

describe("splitLeadingSlashCommand", () =>
{
	it("splits a leading command token from the rest of the prompt", () =>
	{
		expect(
			{
				loop: splitLeadingSlashCommand("/loop Check PR 1954"),
				pluginSkill: splitLeadingSlashCommand("/orchestration:finish"),
				multiline: splitLeadingSlashCommand("/review\nthe diff"),
				path: splitLeadingSlashCommand("/Users/fabricated/file.ts is broken"),
				midText: splitLeadingSlashCommand("please /loop"),
				bareSlash: splitLeadingSlashCommand("/ nothing"),
			},
		).toStrictEqual(
			{
				loop:
				{
					name: "loop",
					rest: "Check PR 1954",
				},
				pluginSkill:
				{
					name: "orchestration:finish",
					rest: "",
				},
				multiline:
				{
					name: "review",
					rest: "the diff",
				},
				path: null,
				midText: null,
				bareSlash: null,
			},
		);
	});
});

describe("cliTwinCommands", () =>
{
	const effort: SlashCommand =
	{
		name: "effort",
		description: "Set the effort level for this session",
		source: "builtin",
		argumentHint: "[level]",
		hostHandled: true,
	};
	const fast: SlashCommand =
	{
		name: "fast",
		description: "Turn fast mode on or off",
		source: "builtin",
		argumentHint: "[on|off]",
		hostHandled: true,
	};
	const model: SlashCommand =
	{
		name: "model",
		description: "Set the model for this session",
		source: "builtin",
		hostHandled: true,
	};
	const review: SlashCommand =
	{
		name: "review",
		description: "Review the current diff",
		source: "builtin",
	};
	const levels = ["low", "medium", "high", "xhigh", "max"];
	const effortTwin: SlashCommand =
	{
		name: "effort",
		description: "Set effort level for model usage",
		source: "builtin",
		argumentHint: "[low|medium|high|xhigh|max|auto]",
		shadowsHost: true,
	};

	it("lists the interactive CLI's own row for each host-handled built-in with CLI copy, gated on fast and model", () =>
	{
		const hostRows = [effort, fast, model, review];
		const usage: SlashCommand =
		{
			name: "usage",
			description: "Show plan usage and rate limits",
			source: "builtin",
			aliases: ["stats", "cost"],
		};

		expect(
			{
				listed: cliTwinCommands(
					hostRows,
					{
						effortLevels: levels,
						fastListed: true,
					},
				),
				fastUnlisted: cliTwinCommands(
					hostRows,
					{
						effortLevels: levels,
						fastListed: false,
					},
				),
				noLevels: cliTwinCommands(
					[effort],
					{
						effortLevels: [],
						fastListed: true,
					},
				).map((c) => c.argumentHint),
				usagePassThrough: cliTwinCommands(
					[usage],
					{
						effortLevels: [],
						fastListed: true,
					},
				),
				usageHost: cliTwinCommands(
					[
						{
							...usage,
							hostHandled: true,
						},
					],
					{
						effortLevels: [],
						fastListed: true,
					},
				),
			},
		).toStrictEqual(
			{
				listed: [
					effortTwin,
					{
						name: "fast",
						description: "Toggle fast mode (Opus 5.5)",
						source: "builtin",
						argumentHint: "[on|off]",
						shadowsHost: true,
					},
				],
				fastUnlisted: [effortTwin],
				noLevels: ["[auto]"],
				usagePassThrough: [],
				usageHost: [
					{
						name: "usage",
						description: "Show session cost, plan usage, and activity stats",
						source: "builtin",
						shadowsHost: true,
					},
				],
			},
		);
	});

	it("yields the single twin slot to a custom command of the same name, as the CLI lists it instead of its own", () =>
	{
		const builtins = [effort];
		const mine: SlashCommand =
		{
			name: "effort",
			description: "Mine (user)",
			source: "personal-command",
		};
		const merged = mergeSlashCommands([
			builtins,
			[mine],
			cliTwinCommands(
				builtins,
				{
					effortLevels: levels,
					fastListed: true,
				},
			),
		]);

		expect(merged).toStrictEqual([
			effort,
			{
				...mine,
				shadowsHost: true,
			},
		]);
	});
});

describe("CLI_COMMAND_NAMES", () =>
{
	it("contains every curated built-in and the CLI's other built-ins and aliases", () =>
	{
		const expected = [
			...BUILTIN_SLASH_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]),
			"doctor",
			"hooks",
			"mcp",
			"agents",
			"memory",
			"resume",
			"security-review",
			"todos",
			"add-dir",
			"output-style",
			"cost",
			"stats",
			"bashes",
			"allowed-tools",
			"exit",
			"quit",
			// New in CLI 2.1.317.
			"use-case",
		];
		expect(expected.filter((name) => !CLI_COMMAND_NAMES.has(name))).toStrictEqual([]);
	});

	it("holds only lowercase command names", () =>
	{
		expect([...CLI_COMMAND_NAMES].filter((name) => !/^[a-z][a-z0-9-]*$/.test(name))).toStrictEqual([]);
	});
});

describe("isKnownSlashCommand", () =>
{
	const pluginSkill: SlashCommand =
	{
		name: "plugin:skill",
		description: "A plugin skill",
		source: "plugin-skill",
		pluginName: "plugin",
	};
	const aliased: SlashCommand =
	{
		name: "deploy",
		description: "Deploy",
		source: "project-command",
		aliases: ["ship"],
	};

	it("knows a CLI built-in without any listed commands", () =>
	{
		expect(isKnownSlashCommand("doctor", [])).toBe(true);
	});

	it("rejects a typo", () =>
	{
		expect(isKnownSlashCommand("statuss", [])).toBe(false);
	});

	it("matches case-insensitively", () =>
	{
		expect([isKnownSlashCommand("STATUS", []), isKnownSlashCommand("Plugin:Skill", [pluginSkill])]).toStrictEqual([
			true,
			true,
		]);
	});

	it("knows a listed plugin skill by its full name and by the part after the last colon", () =>
	{
		expect([
			isKnownSlashCommand("plugin:skill", [pluginSkill]),
			isKnownSlashCommand("skill", [pluginSkill]),
			isKnownSlashCommand("plugin:skill", []),
		]).toStrictEqual([true, true, false]);
	});

	it("knows a listed command's aliases", () =>
	{
		expect([isKnownSlashCommand("deploy", [aliased]), isKnownSlashCommand("ship", [aliased])]).toStrictEqual([
			true,
			true,
		]);
	});
});
