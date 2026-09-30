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
	slashArgumentHint,
	slashQuery,
	splitLeadingSlashCommand,
	type SlashCommand,
} from "../src/lib/slash-commands";
import {listSlashCommands} from "../src/lib/slash-commands.server";

function write(file: string, content: string): void {
	mkdirSync(dirname(file), {recursive: true});
	writeFileSync(file, content);
}

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
			{name: "tools:lint", description: "Lint code", source: "plugin-skill"},
			{
				name: "tools:fix",
				description: "Fix lint errors",
				source: "plugin-command",
				argumentHint: "<path>",
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
	it("lists only the built-ins for an empty query", () => {
		expect(filterSlashCommands(COMMANDS, "").map((c) => c.name)).toStrictEqual(["model", "plan", "compact"]);
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
});

describe("highlightMatches", () => {
	it("splits text into bold match spans, case-insensitively", () => {
		expect(highlightMatches("Autocompact compaction", "comp")).toStrictEqual([
			{text: "Auto", match: false},
			{text: "comp", match: true},
			{text: "act ", match: false},
			{text: "comp", match: true},
			{text: "action", match: false},
		]);
	});

	it("returns the whole text unmatched for an empty query", () => {
		expect(highlightMatches("model", "")).toStrictEqual([{text: "model", match: false}]);
	});
});

describe("slashQuery", () => {
	it("returns the typed command name only while the first token is being typed", () => {
		expect([
			slashQuery("/"),
			slashQuery("/mo"),
			slashQuery("/model "),
			slashQuery("hello /mo"),
			slashQuery("/mo\nnext"),
		]).toStrictEqual(["", "mo", null, null, null]);
	});
});

describe("slashArgumentHint", () => {
	it("shows the accepted command's argument hint until arguments are typed", () => {
		const commands: SlashCommand[] = [
			{name: "model", description: "", source: "builtin", argumentHint: "[model]"},
			{name: "plan", description: "", source: "builtin"},
		];
		expect([
			slashArgumentHint(commands, "/model "),
			slashArgumentHint(commands, "/model opus"),
			slashArgumentHint(commands, "/plan "),
			slashArgumentHint(commands, "/model"),
		]).toStrictEqual(["[model]", null, null, null]);
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
