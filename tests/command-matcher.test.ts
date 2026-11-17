import {describe, expect, it} from "vite-plus/test";
import {CommandMatcher} from "../src/lib/command-matcher";
import
{
	BUILTIN_SLASH_COMMANDS,
	slashMatcherCandidate,
	filterSlashCommands,
	highlightMatches,
	type SlashCommand,
} from "../src/lib/slash-commands";

const names = (commands: readonly SlashCommand[], query: string): string[] =>
	filterSlashCommands(commands, query).map((command) => command.name);

function builtin(name: string, description: string, aliases?: readonly string[]): SlashCommand
{
	return {
		name,
		description,
		source: "builtin",
		...(aliases === undefined
			? {}
			:
				{
					aliases,
				}),
	};
}

/*
 * The live home composer's 16 rows (2026-11-05). Descriptions are upstream's English strings from the host-command
 * table (cc183b3ab); design and slides carry secret-message descriptions, so theirs are stand-ins with no word
 * starting co/re/mo, which is all the queries below depend on.
 */
const HOME_ITEMS: readonly SlashCommand[] = [
	builtin("model", "Set the model for this session"),
	builtin("effort", "Set the effort level for this session"),
	builtin("fast", "Turn fast mode on or off"),
	builtin("plan", "Switch to plan mode or view this session’s plan"),
	builtin("permissions", "Change the permission mode", ["allowed-tools"]),
	builtin("skills", "Browse and manage your skills"),
	builtin("workflows", "Browse workflow history (running and completed)", ["workflow"]),
	builtin("usage", "Show plan usage and rate limits", ["stats", "cost"]),
	builtin("usage-credits", "Open usage settings", ["extra-usage"]),
	builtin("config", "Open Claude Code settings", ["settings"]),
	builtin("sandbox", "Open Claude Code sandbox settings"),
	builtin("theme", "Set the appearance (system, light, or dark)"),
	builtin("login", "Sign in again", ["logout"]),
	builtin("help", "Get help and support"),
	builtin("design", "Draft a design on a canvas Artifact — editable where saving is enabled (Claude Design preview)"),
	builtin("slides", "Draft a slide deck"),
];

describe("CommandMatcher (upstream qn on fuse.js 7.0.0)", () =>
{
	it("ranks the local built-ins as upstream's matcher does", () =>
	{
		const queries = ["re", "co", "cl", "mdel", "plna", "rent", "sum", "s"] as const;
		expect(Object.fromEntries(queries.map((query) => [query, names(BUILTIN_SLASH_COMMANDS, query)]))).toStrictEqual(
			{
				re: ["recap", "rename", "review"],
				co: ["config", "compact", "context", "usage", "workflows", "clear", "init"],
				cl: ["clear", "init", "config", "review"],
				mdel: ["model"],
				plna: ["plan"],
				rent: ["rename"],
				sum: ["compact"],
				// The 2026-11-05 simulation listed status second; it has since moved to SESSION_SLASH_COMMANDS.
				s: [
					"skills",
					"usage",
					"config",
					"fast",
					"permissions",
					"workflows",
					"plan",
					"compact",
					"model",
					"effort",
					"theme",
					"btw",
					"clear",
					"help",
					"rename",
					"context",
					"recap",
				],
			},
		);
	});

	it("reproduces the live home composer's rows", () =>
	{
		expect(
			{
				co: names(HOME_ITEMS, "co"),
				re: names(HOME_ITEMS, "re"),
				mo: names(HOME_ITEMS, "mo"),
			},
		).toStrictEqual(
			{
				co: ["config", "usage", "workflows", "sandbox"],
				re: ["usage-credits"],
				mo: ["model", "fast", "plan", "permissions"],
			},
		);
	});

	it("indexes description words with punctuation stripped and split", () =>
	{
		const matcher = new CommandMatcher([
			{
				name: "status",
				displayName: "status",
				description: "Show this session’s version",
				aliases: [],
				usageKey: "status",
			},
		]);
		expect(matcher.items.map((item) => item.descriptionWords)).toStrictEqual([
			["s", "session", "sessions", "show", "this", "version"],
		]);
	});

	it("matches description words only within the first 20 words", () =>
	{
		const filler = Array.from(
			{
				length: 20,
			},
			(_, i) => `w${i}`,
		).join(" ");
		expect(names([builtin("long", `${filler} zebra`), builtin("short", "a zebra here")], "zebra")).toStrictEqual([
			"short",
		]);
	});

	it("splits a plugin name into part keys and finds it by a part", () =>
	{
		const command: SlashCommand =
		{
			name: "build:dev-server",
			pluginName: "build",
			description: "",
			source: "plugin-skill",
		};
		const matcher = new CommandMatcher([slashMatcherCandidate(command)]);
		expect(
			{
				parts: matcher.items.map((item) => [item.partKey, item.displayPartKey]),
				server: names([command], "server"),
			},
		).toStrictEqual(
			{
				parts: [
					[
						["build", "dev", "server"],
						["dev", "server"],
					],
				],
				server: ["build:dev-server"],
			},
		);
	});

	it("leaves a fuzzy row's name unhighlighted", () =>
	{
		expect(highlightMatches("model", "mdel")).toStrictEqual([
			{
				text: "model",
				match: false,
			},
		]);
	});
});
