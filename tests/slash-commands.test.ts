import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {SlashCommandListResponse} from "../src/lib/api/commands";
import {
	BUILTIN_SLASH_COMMANDS,
	filterSlashCommands,
	highlightMatches,
	mergeSlashCommands,
	skillChipArgumentHint,
	slashCommandLabel,
	slashTrigger,
	splitLeadingSlashCommand,
	type SlashCommand,
} from "../src/lib/slash-commands";
import {listSlashCommands} from "../src/lib/slash-commands.server";

function write(file: string, content: string): void {
	mkdirSync(dirname(file), {recursive: true});
	writeFileSync(file, content);
}

describe("BUILTIN_SLASH_COMMANDS", () => {
	it("uses upstream's strings, hints and aliases, then the local-only built-ins", () => {
		expect(BUILTIN_SLASH_COMMANDS).toStrictEqual([
			{
				name: "model",
				description: "Set the model for this session",
				source: "builtin",
				argumentHint: "[model-id]",
			},
			{
				name: "effort",
				description: "Set the effort level for this session",
				source: "builtin",
				argumentHint: "[level]",
			},
			{name: "fast", description: "Turn fast mode on or off", source: "builtin", argumentHint: "[on|off]"},
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
			},
			{name: "skills", description: "Browse and manage your skills", source: "builtin"},
			{
				name: "usage",
				description: "Show plan usage and rate limits",
				source: "builtin",
				aliases: ["stats", "cost"],
			},
			{name: "config", description: "Open Claude Code settings", source: "builtin", aliases: ["settings"]},
			{
				name: "theme",
				description: "Set the appearance (system, light, or dark)",
				source: "builtin",
				argumentHint: "[system|light|dark]",
			},
			{name: "help", description: "Get help and support", source: "builtin"},
			{
				name: "btw",
				description: "Ask a quick side question without adding to the session",
				source: "builtin",
				argumentHint: "<question>",
			},
			{name: "rename", description: "Rename this session", source: "builtin", argumentHint: "[name]"},
			{
				name: "status",
				description: "Show this session’s version, model, environment, and account",
				source: "builtin",
			},
			{
				name: "compact",
				description: "Clear conversation history but keep a summary in context",
				source: "builtin",
				argumentHint: "[instructions]",
			},
			{name: "clear", description: "Clear conversation history and free up context", source: "builtin"},
			{name: "context", description: "Show current context usage", source: "builtin"},
			{name: "review", description: "Review a pull request", source: "builtin", argumentHint: "[pr]"},
			{
				name: "init",
				description: "Initialize a new CLAUDE.md file with codebase documentation",
				source: "builtin",
			},
		]);
	});
});

describe("mergeSlashCommands", () => {
	it("keeps the first command for each name, in group order", () => {
		const merged = mergeSlashCommands([
			[{name: "model", description: "Built-in model", source: "builtin"}],
			[
				{name: "deploy", description: "Personal deploy", source: "personal-skill"},
				{name: "model", description: "Shadowed model", source: "personal-skill"},
			],
			[{name: "deploy", description: "Project deploy", source: "project-command"}],
			[{name: "tools:lint", description: "Lint", source: "plugin-skill"}],
		]);

		expect(merged).toStrictEqual([
			{name: "model", description: "Built-in model", source: "builtin"},
			{name: "deploy", description: "Personal deploy", source: "personal-skill"},
			{name: "tools:lint", description: "Lint", source: "plugin-skill"},
		]);
	});
});

describe("listSlashCommands", () => {
	let root: string;
	let claudeDir: string;
	let cwd: string;
	let pluginPath: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "slash-commands-"));
		claudeDir = join(root, "claude");
		cwd = join(root, "repos", "my-app");
		pluginPath = join(root, "plugin-cache", "tools", "1.0.0");
		mkdirSync(claudeDir, {recursive: true});
	});

	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	it("merges built-ins, skills, commands and plugin entries with skills shadowing commands", async () => {
		write(
			join(claudeDir, "skills", "deploy", "SKILL.md"),
			'---\nname: deploy\ndescription: Personal deploy skill\nargument-hint: "[env]"\n---\n',
		);
		write(
			join(claudeDir, "skills", "hidden", "SKILL.md"),
			"---\nname: hidden\ndescription: Model only\nuser-invocable: false\n---\n",
		);
		write(join(claudeDir, "skills", "off", "SKILL.md"), "---\nname: off\ndescription: Disabled\n---\n");
		write(join(claudeDir, "settings.json"), JSON.stringify({skillOverrides: {off: "off"}}));
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
		write(join(claudeDir, "commands", "model.md"), "---\ndescription: Shadowed built-in\n---\n");
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
			JSON.stringify({
				version: 2,
				plugins: {
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
			}),
		);

		const commands = await listSlashCommands({claudeDir, cwd});

		expect(SlashCommandListResponse.parse(commands)).toStrictEqual([
			...BUILTIN_SLASH_COMMANDS,
			{
				name: "deploy",
				description: "Personal deploy skill",
				source: "personal-skill",
				argumentHint: "[env]",
			},
			{name: "release", description: "Cut a release", source: "project-skill"},
			{
				name: "standup",
				description: "Write my standup",
				source: "personal-command",
				argumentHint: "[date]",
			},
			{name: "triage", description: "Triage the open issues", source: "project-command"},
			{name: "tools:lint", description: "Lint code", source: "plugin-skill", pluginName: "tools"},
			{
				name: "tools:fix",
				description: "Fix lint errors",
				source: "plugin-command",
				argumentHint: "<path>",
				pluginName: "tools",
			},
		]);
	});

	it("lists only personal and plugin entries without a cwd", async () => {
		write(join(claudeDir, "commands", "standup.md"), "---\ndescription: Write my standup\n---\n");

		expect(await listSlashCommands({claudeDir, cwd: undefined})).toStrictEqual([
			...BUILTIN_SLASH_COMMANDS,
			{name: "standup", description: "Write my standup", source: "personal-command"},
		]);
	});
});

const COMMANDS: SlashCommand[] = [
	{name: "model", description: "Set the model for this session", source: "builtin"},
	{name: "plan", description: "Plan before coding", source: "builtin"},
	{name: "compact", description: "Summarize the conversation", source: "builtin"},
	{name: "git:commit", description: "Commit local changes", source: "plugin-skill"},
	{name: "autocompact", description: "Custom compaction", source: "personal-command"},
];

describe("filterSlashCommands", () => {
	it("lists every command in list order for an empty query", () => {
		expect(filterSlashCommands(COMMANDS, "").map((c) => c.name)).toStrictEqual([
			"model",
			"plan",
			"compact",
			"git:commit",
			"autocompact",
		]);
	});

	it("ranks name prefix over name contains over description matches, case-insensitively", () => {
		expect(filterSlashCommands(COMMANDS, "CO").map((c) => c.name)).toStrictEqual([
			"compact",
			"git:commit",
			"autocompact",
			"plan",
		]);
	});

	it("returns nothing when no name or description matches", () => {
		expect(filterSlashCommands(COMMANDS, "zzz")).toStrictEqual([]);
	});

	it("ranks upstream's tiers: exact name, exact alias, name prefix, alias prefix, contains, then description", () => {
		const commands: SlashCommand[] = [
			{name: "described", description: "Mentions set in prose", source: "builtin"},
			{name: "reset", description: "", source: "builtin"},
			{name: "theme", description: "", source: "builtin", aliases: ["colorset"]},
			{name: "config", description: "", source: "builtin", aliases: ["settings"]},
			{name: "setup", description: "", source: "builtin"},
			{name: "permissions", description: "", source: "builtin", aliases: ["set"]},
			{name: "set", description: "", source: "builtin"},
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

	it("puts config first for its settings alias", () => {
		const commands: SlashCommand[] = [
			{name: "plugin-dev:plugin-settings", description: "", source: "plugin-skill"},
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

	it("returns nothing for a query over 50 characters", () => {
		const commands: SlashCommand[] = [{name: "a".repeat(51), description: "", source: "builtin"}];

		expect({
			fifty: filterSlashCommands(commands, "a".repeat(50)).length,
			fiftyOne: filterSlashCommands(commands, "a".repeat(51)),
		}).toStrictEqual({fifty: 1, fiftyOne: []});
	});
});

describe("plugin skills", () => {
	const devServer: SlashCommand = {
		name: "build:dev-server",
		description: "Start a dev server",
		source: "plugin-skill",
		pluginName: "build",
	};
	const commands: SlashCommand[] = [
		{name: "redevelop", description: "", source: "builtin"},
		devServer,
		{name: "build", description: "", source: "builtin"},
	];

	it("labels a plugin skill by its bare name and leaves other commands unchanged", () => {
		expect({
			plugin: slashCommandLabel(devServer),
			builtin: slashCommandLabel({name: "model", description: "", source: "builtin"}),
			unprefixed: slashCommandLabel({...devServer, name: "dev-server"}),
		}).toStrictEqual({plugin: "dev-server", builtin: "model", unprefixed: "dev-server"});
	});

	it("ranks the bare label as the name and still matches plugin:name queries", () => {
		expect({
			dev: filterSlashCommands(commands, "dev").map((c) => c.name),
			exact: filterSlashCommands(commands, "dev-server").map((c) => c.name),
			namespaced: filterSlashCommands(commands, "build:dev").map((c) => c.name),
		}).toStrictEqual({
			dev: ["build:dev-server", "redevelop"],
			exact: ["build:dev-server"],
			namespaced: ["build:dev-server"],
		});
	});
});

describe("highlightMatches", () => {
	it("bolds only the first case-insensitive match", () => {
		expect([
			highlightMatches("status", "s"),
			highlightMatches("Browse and manage your skills", "s"),
			highlightMatches("Autocompact compaction", "COMP"),
		]).toStrictEqual([
			[
				{text: "s", match: true},
				{text: "tatus", match: false},
			],
			[
				{text: "Brow", match: false},
				{text: "s", match: true},
				{text: "e and manage your skills", match: false},
			],
			[
				{text: "Auto", match: false},
				{text: "comp", match: true},
				{text: "act compaction", match: false},
			],
		]);
	});

	it("returns the whole text unmatched when the query does not occur", () => {
		expect(highlightMatches("model", "zz")).toStrictEqual([{text: "model", match: false}]);
	});

	it("returns the whole text unmatched for an empty query", () => {
		expect(highlightMatches("model", "")).toStrictEqual([{text: "model", match: false}]);
	});
});

describe("slashTrigger", () => {
	const at = (prompt: string) => slashTrigger(prompt, prompt.length);

	it("opens selected at the start of the prompt while the first token is being typed", () => {
		expect([at("/"), at("/mo"), at("/model "), at("/mo/"), slashTrigger("/mo\nnext", 3)]).toStrictEqual([
			{start: 0, query: "", atStart: true},
			{start: 0, query: "mo", atStart: true},
			null,
			null,
			{start: 0, query: "mo", atStart: true},
		]);
	});

	it("opens unselected after text or at the start of a later line, but not for an empty mid-line query", () => {
		expect([
			at("hello /mo"),
			at("line one\n/ef"),
			at("hello /"),
			at("x/"),
			slashTrigger("hello /mo there", 9),
			slashTrigger("hello /model", 9),
		]).toStrictEqual([
			{start: 6, query: "mo", atStart: false},
			{start: 9, query: "ef", atStart: false},
			null,
			null,
			{start: 6, query: "mo", atStart: false},
			null,
		]);
	});
});

describe("skillChipArgumentHint", () => {
	it("shows an accepted chip's argument hint while only whitespace follows it", () => {
		const chip = {name: "model", argumentHint: "[model]"};
		expect([
			skillChipArgumentHint(chip, "/model "),
			skillChipArgumentHint(chip, "/model   "),
			skillChipArgumentHint(chip, "/model \n"),
			skillChipArgumentHint(chip, "/model\t"),
		]).toStrictEqual(["[model]", "[model]", "[model]", "[model]"]);
	});

	it("hides the hint with no separator, typed arguments, a long prompt or no hint", () => {
		const chip = {name: "model", argumentHint: "[model]"};
		expect([
			skillChipArgumentHint(chip, "/model"),
			skillChipArgumentHint(chip, "/model x"),
			skillChipArgumentHint(chip, "/modelx "),
			skillChipArgumentHint(chip, "/model\n"),
			skillChipArgumentHint(chip, `/model ${" ".repeat(122)}`),
			skillChipArgumentHint(chip, `/model ${" ".repeat(121)}`),
			skillChipArgumentHint({name: "model", argumentHint: undefined}, "/model "),
			skillChipArgumentHint({name: "model", argumentHint: ""}, "/model "),
		]).toStrictEqual([null, null, null, null, null, "[model]", null, null]);
	});
});

describe("splitLeadingSlashCommand", () => {
	it("splits a leading command token from the rest of the prompt", () => {
		expect({
			loop: splitLeadingSlashCommand("/loop Check PR 1954"),
			pluginSkill: splitLeadingSlashCommand("/orchestration:finish"),
			multiline: splitLeadingSlashCommand("/review\nthe diff"),
			path: splitLeadingSlashCommand("/Users/fabricated/file.ts is broken"),
			midText: splitLeadingSlashCommand("please /loop"),
			bareSlash: splitLeadingSlashCommand("/ nothing"),
		}).toStrictEqual({
			loop: {name: "loop", rest: "Check PR 1954"},
			pluginSkill: {name: "orchestration:finish", rest: ""},
			multiline: {name: "review", rest: "the diff"},
			path: null,
			midText: null,
			bareSlash: null,
		});
	});
});
