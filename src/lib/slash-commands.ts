/**
 * Composer "/" autocomplete: the curated CLI built-ins plus the pure merge,
 * ranking and highlight logic shared by the popup and `GET /api/commands`.
 */
import {type CommandCandidate, CommandMatcher} from "./command-matcher";

export const SLASH_COMMAND_SOURCES = [
	"builtin",
	"personal-skill",
	"project-skill",
	"personal-command",
	"project-command",
	"plugin-skill",
	"plugin-command",
] as const;

export type SlashCommandSource = (typeof SLASH_COMMAND_SOURCES)[number];

export interface SlashCommand
{
	name: string;
	description: string;
	source: SlashCommandSource;
	argumentHint?: string | undefined;
	/** Other names the command answers to, ranked and shown as a muted `(alias)` suffix as upstream does. */
	aliases?: readonly string[] | undefined;
	/** The plugin a plugin skill or command comes from; upstream labels the row by the bare name and names the plugin beside it. */
	pluginName?: string | undefined;
	/**
	 * The composer runs this command itself (upstream's host catalog row); a user/project command of the same
	 * name or alias is listed beside it as a `Custom command` twin.
	 */
	hostHandled?: true | undefined;
	/**
	 * A user, project or plugin entry whose name or alias collides with a `hostHandled` built-in. Upstream lists
	 * it as a second row tagged "Custom command"; picking it routes the command to the CLI (`slashRouting:"cli"`),
	 * skipping the composer's host intercepts.
	 */
	shadowsHost?: true | undefined;
}

/** The row key upstream's `R8` builds (`name:routing`): a twin stays a distinct row from its host row. */
export function slashCommandRowKey(command: SlashCommand): string
{
	return command.shadowsHost === true ? `${command.name}:cli` : command.name;
}

/** One row of the "/" popup, mirroring upstream's `SlashCommandMenuPopupBody` item types. */
export type SlashMenuItem =
	|
	  {
			type: "command";
			command: SlashCommand;
	  }
	|
	  {
			type: "section-header";
			label: string;
	  }
	|
	  {
			type: "separator";
	  }
	|
	  {
			type: "loading";
	  };

/** Upstream's `bB`: ↑/↓ skip headers, separators and the loading row. */
function isSelectableSlashItem(item: SlashMenuItem): item is
{
	type: "command";
	command: SlashCommand;
}
{
	return item.type === "command";
}

/**
 * The highlight after ↑/↓ (`move` ±1) from `current`, skipping unselectable items and
 * clamping at both ends; from nothing highlighted (-1), ↓ picks the first row and ↑ the last.
 */
export function stepSlashHighlight(items: readonly SlashMenuItem[], current: number, move: 1 | -1): number
{
	const selectable = items.flatMap((item, index) => (isSelectableSlashItem(item) ? [index] : []));
	if (current === -1) return (move === 1 ? selectable[0] : selectable.at(-1)) ?? -1;
	const next =
		move === 1 ? selectable.find((index) => index > current) : selectable.findLast((index) => index < current);
	return next ?? current;
}

/** The first selectable item, or -1 when none is. */
export function firstSlashHighlight(items: readonly SlashMenuItem[]): number
{
	return stepSlashHighlight(items, -1, 1);
}

/** Keeps a remembered highlight on a selectable item after the list shrinks. */
export function clampSlashHighlight(items: readonly SlashMenuItem[], index: number): number
{
	if (index === -1) return -1;
	const selectable = items.flatMap((item, i) => (isSelectableSlashItem(item) ? [i] : []));
	return selectable.find((i) => i >= index) ?? selectable.at(-1) ?? -1;
}

/** The row label: a plugin entry's name without its `plugin:` namespace, as upstream shows plugin skills. */
export function slashCommandLabel(command: SlashCommand): string
{
	const prefix = command.pluginName === undefined ? undefined : `${command.pluginName}:`;
	return prefix !== undefined && command.name.startsWith(prefix) ? command.name.slice(prefix.length) : command.name;
}

/**
 * Built-ins upstream offers only in a session's composer (there's nothing to rewind on the home
 * page, and `/status` is gated on `hasSession`). `GET /api/commands` leaves them out; `useSlashCommands` adds them for sessions.
 */
export const SESSION_SLASH_COMMANDS: readonly SlashCommand[] = [
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
];

/**
 * claude.ai/code's locally meaningful built-ins with its exact strings, hints and
 * aliases, followed by the local-only CLI built-ins.
 */
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommand[] = [
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
	/* Local-only built-ins with no claude.ai/code row. */
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
];

/*
 * Every built-in name and alias the CLI answers to, plus its bundled skills, so a mistyped
 * `/name` can be told apart from a real command. Seeded from CLI 2.1.310 (re-checked against 2.1.317) with
 *   rg -ao 'type:"(local-jsx|local|prompt)",name:"[a-z][a-z0-9:-]*"' <binary>
 *   rg -ao 'name:"[a-z][a-z0-9:-]*",[^{}]{0,300}type:"(local-jsx|local|prompt)"' <binary>
 *   rg -ao 'Wi\(\{name:"[a-z][a-z0-9:-]*"' <binary>
 * plus each match's `aliases:[…]`, the `mK({name})` cloud commands, the bundled-skill name array,
 * and review, security-review and todos from earlier CLI versions.
 */
const CLI_BUILTIN_NAMES = [
	"add-dir",
	"advisor",
	"agents",
	"allowed-tools",
	"android",
	"app",
	"artifact-components",
	"artifact-diagramming",
	"artifacts",
	"auto-mode-setup",
	"autocompact",
	"autofix-pr",
	"background",
	"bashes",
	"batch",
	"bg",
	"branch",
	"break-reminder",
	"breaks",
	"brief",
	"btw",
	"bug",
	"cd",
	"checkpoint",
	"checkup",
	"claude-api",
	"claude-code-docs",
	"claude-in-chrome",
	"clear",
	"cloud-plugins",
	"code-review",
	"color",
	"commit",
	"compact",
	"config",
	"context",
	"copy",
	"cost",
	"daemon",
	"dataviz",
	"debug",
	"design-consent",
	"design-login",
	"design-revoke",
	"design-sync",
	"desktop",
	"diff",
	"doctor",
	"downtime",
	"effort",
	"exit",
	"explain-usage",
	"export",
	"extra-usage",
	"fast",
	"feedback",
	"fewer-permission-prompts",
	"focus",
	"fork",
	"goal",
	"heapdump",
	"help",
	"hooks",
	"ide",
	"import",
	"init",
	"insights",
	"install",
	"install-github-app",
	"install-slack-app",
	"ios",
	"keybindings",
	"keybindings-help",
	"list-agents",
	"login",
	"logout",
	"loop",
	"loops",
	"marketplace",
	"mcp",
	"memory",
	"memory-pause",
	"memory-types",
	"mobile",
	"model",
	"name",
	"new",
	"output-style",
	"passes",
	"pause-memory",
	"peers",
	"permissions",
	"plan",
	"plugin",
	"plugin-authoring",
	"plugins",
	"powerup",
	"pr",
	"privacy-settings",
	"pro-trial-expired",
	"quit",
	"radio",
	"rate-limit-options",
	"rc",
	"recap",
	"release-notes",
	"reload-plugins",
	"reload-skills",
	"remote",
	"remote-control",
	"remote-env",
	"rename",
	"reset",
	"restart",
	"resume",
	"review",
	"rewind",
	"run",
	"run-skill-generator",
	"schedule",
	"scroll-speed",
	"security-review",
	"session",
	"settings",
	"setup-bedrock",
	"setup-vertex",
	"simplify",
	"skill-doctor",
	"skills",
	"stats",
	"status",
	"stickers",
	"stop",
	"subtask",
	"tasks",
	"team-onboarding",
	"teleport",
	"terminal-setup",
	"theme",
	"todos",
	"toggle-memory",
	"tp",
	"tui",
	"ultraplan",
	"ultrareview",
	"undo",
	"update",
	"update-config",
	"upgrade",
	"usage",
	"usage-credits",
	"use-case",
	"verify",
	"version",
	"voice",
	"web-setup",
	"wellbeing",
	"workflow-authoring",
	"workflow-launch-exec",
	"workflows",
] as const;

/** The CLI's command names and aliases together with the curated built-ins, all lowercase. */
export const CLI_COMMAND_NAMES: ReadonlySet<string> = new Set([
	...CLI_BUILTIN_NAMES,
	...BUILTIN_SLASH_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]),
]);

/**
 * Whether the CLI would run `/name`: a CLI built-in or alias, or a command from `GET /api/commands`
 * by its name, an alias, or the part after the last `:` of a plugin entry. Case-insensitive.
 */
export function isKnownSlashCommand(name: string, slashCommands: readonly SlashCommand[]): boolean
{
	const needle = name.toLowerCase();
	if (CLI_COMMAND_NAMES.has(needle)) return true;
	return slashCommands.some((command) =>
		[command.name, command.name.slice(command.name.lastIndexOf(":") + 1), ...(command.aliases ?? [])].some(
			(label) => label.toLowerCase() === needle,
		),
	);
}

/**
 * The local interactive CLI's (2.1.319) own rows for names the web app may intercept. Cloud sessions list the
 * non-interactive copy instead. Twins carry no aliases, as upstream's do. The strings were read from the binary with
 * `rg -ao '.{0,250}name:"<n>".{0,700}' <binary> | grep 'type:"local'`; effort's hint is computed per model.
 */
export const CLI_TWIN_COPY: Readonly<
	Record<
		string,
		{
			description: string;
			argumentHint?: string;
		}
	>
> =
{
	autocompact:
	{
		description: "Set how full the context gets before auto-summarizing",
		argumentHint: "[auto|<tokens>]",
	},
	effort:
	{
		description: "Set effort level for model usage",
	},
	fast:
	{
		description: "Toggle fast mode (Opus 5.5)",
		argumentHint: "[on|off]",
	},
	permissions:
	{
		description: "Manage allow and deny tool permission rules",
	},
	rewind:
	{
		description: "Restore the code and/or conversation to a previous point",
	},
	workflows:
	{
		description: "Browse running and completed workflows",
	},
	btw:
	{
		description: "Ask a quick side question without interrupting the main conversation",
		argumentHint: "[question]",
	},
	usage:
	{
		description: "Show session cost, plan usage, and activity stats",
	},
	config:
	{
		description: "Open settings",
		argumentHint: "[key=value]",
	},
	advisor:
	{
		description: "Let Claude consult a stronger model at key moments",
		argumentHint: "[fable|opus|sonnet|off]",
	},
	plan:
	{
		description: "Enable plan mode or view the current session plan",
		argumentHint: "[open|<description>]",
	},
	skills:
	{
		description: "List available skills",
	},
	status:
	{
		description: "Show Claude Code status including version, model, account, API connectivity, and tool statuses",
	},
};

/** Upstream's `hidesCliRow` host rows: neither the CLI's own row nor a custom twin of these is listed. */
export const HIDES_CLI_ROW: ReadonlySet<string> = new Set(["model", "rename"]);

/** What decides the CLI's own twin rows: the current model's effort levels, and whether the CLI lists `/fast`. */
export interface CliTwinContext
{
	effortLevels: readonly string[];
	/** False when the CLI hides `/fast` (a third-party provider, or `CLAUDE_CODE_DISABLE_FAST_MODE`). */
	fastListed: boolean;
}

/**
 * The local interactive CLI's own row, marked `shadowsHost`, for each `hostHandled` host row with
 * {@link CLI_TWIN_COPY}, in that table's order, as upstream twins the session CLI's commands against its host rows.
 */
export function cliTwinCommands(hostRows: readonly SlashCommand[], ctx: CliTwinContext): SlashCommand[]
{
	const handled = new Set(hostRows.filter((row) => row.hostHandled === true).map((row) => row.name));
	return Object.entries(CLI_TWIN_COPY).flatMap(([name, copy]) =>
	{
		if (!handled.has(name) || HIDES_CLI_ROW.has(name)) return [];
		if (name === "fast" && !ctx.fastListed) return [];
		const argumentHint = name === "effort" ? `[${[...ctx.effortLevels, "auto"].join("|")}]` : copy.argumentHint;
		return [
			{
				name,
				description: copy.description,
				source: "builtin",
				...(argumentHint === undefined
					? {}
					:
						{
							argumentHint,
						}),
				shadowsHost: true,
			},
		];
	});
}

/**
 * Flattens groups given in precedence order; the first entry for a name wins. A custom (non-built-in) entry
 * colliding by name or alias with a `hostHandled` built-in is kept after it as a `shadowsHost` twin (dropped for
 * `HIDES_CLI_ROW` names), as upstream twins CLI rows against its host rows. One sharing the name of a built-in the
 * CLI runs replaces that row in place, since the CLI runs the custom command instead of its own. A built-in
 * pre-marked `shadowsHost` (the CLI's own row, {@link cliTwinCommands}) twins the same way, and is listed
 * plain when no host row collides.
 */
export function mergeSlashCommands(groups: readonly (readonly SlashCommand[])[]): SlashCommand[]
{
	const builtins = groups.flat().filter((command) => command.source === "builtin" && command.shadowsHost !== true);
	const hostNames = new Set(
		builtins.flatMap((command) => (command.hostHandled === true ? [command.name, ...(command.aliases ?? [])] : [])),
	);
	const passThroughNames = new Set(
		builtins.filter((command) => command.hostHandled !== true).map((command) => command.name),
	);
	const seen = new Set<string>();
	const seenTwins = new Set<string>();
	const replaced = new Set<string>();
	const merged: SlashCommand[] = [];
	for (const group of groups)
	{
		for (const command of group)
		{
			if (command.source !== "builtin" || command.shadowsHost === true)
			{
				const names = [command.name, ...(command.aliases ?? [])];
				if (names.some((name) => hostNames.has(name)))
				{
					if (seenTwins.has(command.name) || names.some((name) => HIDES_CLI_ROW.has(name))) continue;
					seenTwins.add(command.name);
					merged.push(
						{
							...command,
							shadowsHost: true,
						},
					);
					continue;
				}
				if (command.source === "builtin")
				{
					// A CLI twin with no host row to twin against is a plain CLI row.
					const {shadowsHost: _twin, ...plain} = command;
					if (seen.has(plain.name)) continue;
					seen.add(plain.name);
					merged.push(plain);
					continue;
				}
				if (passThroughNames.has(command.name))
				{
					if (replaced.has(command.name)) continue;
					replaced.add(command.name);
					seen.add(command.name);
					const index = merged.findIndex((row) => row.source === "builtin" && row.name === command.name);
					if (index === -1) merged.push(command);
					else merged[index] = command;
					continue;
				}
			}
			if (seen.has(command.name)) continue;
			seen.add(command.name);
			merged.push(command);
		}
	}
	return merged;
}

/* Upstream's slash matcher shows no items for a query longer than this. */
const MAX_SLASH_QUERY_LENGTH = 50;

/** A slash command as upstream's `LM` builds a candidate; every local row counts as a skill, as Claude Code's do. */
export interface SlashMatcherCandidate extends CommandCandidate
{
	command: SlashCommand;
}

export function slashMatcherCandidate(command: SlashCommand): SlashMatcherCandidate
{
	const label = slashCommandLabel(command).toLowerCase();
	const name = command.pluginName === undefined ? label : `${command.pluginName.toLowerCase()}:${label}`;
	return {
		command,
		name,
		displayName: label,
		description: command.description.split(/\s+/).slice(0, 20).join(" "),
		aliases: (command.aliases ?? []).map((alias) => alias.toLowerCase()),
		usageKey: name,
	};
}

/* One matcher per commands array, as upstream's `mR` caches in a WeakMap. */
const slashMatchers = new WeakMap<readonly SlashCommand[], CommandMatcher<SlashMatcherCandidate>>();

/* Upstream `r6`: the head is an exact name or alias (`W$` rank 0 or 1), so a space after it ends the command. */
function isExactSlashHead(commands: readonly SlashCommand[], head: string): boolean
{
	return commands.some((command) =>
	{
		const {name, displayName, aliases} = slashMatcherCandidate(command);
		return name === head || displayName === head || aliases.includes(head);
	});
}

/**
 * Upstream `tG` with its matcher loaded and `spaceEndsCommand` (shared-33): an empty query lists every command in
 * list order; otherwise upstream's `CommandMatcher` ranks the trimmed, lowercased query. A trailing space keeps
 * ranking the head; a second word or an exact name/alias head closes.
 */
export function filterSlashCommands(commands: readonly SlashCommand[], query: string): SlashCommand[]
{
	if (query === "") return [...commands];
	if (query.length > MAX_SLASH_QUERY_LENGTH) return [];
	const needle = query.trim().toLowerCase();
	if (needle === "") return [];
	const head = /^(\S+)\s+(\S)?/.exec(query.trimStart().toLowerCase());
	if (head !== null && (head[2] !== undefined || isExactSlashHead(commands, head[1] ?? ""))) return [];
	let matcher = slashMatchers.get(commands);
	if (matcher === undefined)
	{
		matcher = new CommandMatcher(commands.map(slashMatcherCandidate));
		slashMatchers.set(commands, matcher);
	}
	return matcher.search(needle).map((candidate) => candidate.command);
}

/** The first alias that starts with the query, which upstream appends to the row as `(alias)`. */
export function matchingAlias(command: SlashCommand, query: string): string | undefined
{
	const needle = query.trim().toLowerCase();
	if (needle === "") return undefined;
	return command.aliases?.find((alias) => alias.toLowerCase().startsWith(needle));
}

export interface HighlightSegment
{
	text: string;
	match: boolean;
}

/**
 * Splits `text` around the first case-insensitive occurrence of the trimmed `query`, as upstream bolds only the first
 * match of its menu context's trimmed query (`Nb`).
 */
export function highlightMatches(text: string, rawQuery: string): HighlightSegment[]
{
	const query = rawQuery.trim();
	const index = query === "" ? -1 : text.toLowerCase().indexOf(query.toLowerCase());
	if (index === -1)
		return [
			{
				text,
				match: false,
			},
		];
	const end = index + query.length;
	const segments: HighlightSegment[] = [];
	if (index > 0)
		segments.push(
			{
				text: text.slice(0, index),
				match: false,
			},
		);
	segments.push(
		{
			text: text.slice(index, end),
			match: true,
		},
	);
	if (end < text.length)
		segments.push(
			{
				text: text.slice(end),
				match: false,
			},
		);
	return segments;
}

export interface SlashTrigger
{
	/** Index of the `/` in the prompt. */
	start: number;
	query: string;
	/** True at message start (only whitespace before the `/`), where upstream opens with row 0 highlighted. */
	atStart: boolean;
}

/**
 * The `/query` token ending at the caret, or null. Upstream's tiptap trigger allows spaces: `/mo ` keeps the token
 * open and `filterSlashCommands` decides whether it still ranks. Upstream `allow` (shared-9 `Zr`,
 * `midMessageNeedsName` live): mid-message the query must start with `[\p{L}\p{N}_]`; message start ignores leading
 * whitespace (`Pl`/`yl`) and opens selected (`$5`). Only a plain space or a line start may precede the `/` (tiptap
 * `allowedPrefixes:[" "]`), and a query may not start with whitespace or span a line.
 */
export function slashTrigger(prompt: string, caret: number): SlashTrigger | null
{
	if (/^\S/.test(prompt.slice(caret))) return null;
	/*
	 * Upstream keeps a `/` inside the query (`/mo/` → `mo/`), but its matcher finds nothing for one, so excluding `/`
	 * gives the same menu and keeps `/Users/…` paths quiet.
	 */
	const match = /(?:^|[ \n])\/([^\n/]*)$/.exec(prompt.slice(0, caret));
	if (match === null) return null;
	const query = match[1] ?? "";
	if (/^\s/.test(query)) return null;
	const start = caret - query.length - 1;
	const atStart = !/[^\s\u200b-\u200d\u2060]/.test(prompt.slice(0, start));
	if (!atStart && !/^[\p{L}\p{N}_]/u.test(query)) return null;
	return {
		start,
		query,
		atStart,
	};
}

/** Upstream `skillChipArgumentHint` gives up past this doc size. */
const SKILL_CHIP_HINT_MAX_LENGTH = 128;

/**
 * An accepted chip's argument hint, shown as upstream's `skillChipArgumentHint` does: only whitespace
 * after the chip, and at least one space or tab right after it on the chip's own line.
 */
export function skillChipArgumentHint(
	chip:
	{
		name: string;
		argumentHint: string | undefined;
	},
	prompt: string,
): string | null
{
	if (chip.argumentHint === undefined || chip.argumentHint === "") return null;
	const token = `/${chip.name}`;
	if (!prompt.startsWith(token) || prompt.length > SKILL_CHIP_HINT_MAX_LENGTH) return null;
	const rest = prompt.slice(token.length);
	if (rest.trim() !== "" || !/^[ \t]/.test(rest)) return null;
	return chip.argumentHint;
}

const LEADING_SLASH_COMMAND_RE = /^\/([A-Za-z0-9][\w:.-]*)(?:[ \t]+|\n|$)/;

/**
 * Split a prompt that opens with a `/name` token into the command name and the text after it,
 * as upstream renders a leading slash command as a chip. A path such as `/Users/…` is not a command.
 */
export function splitLeadingSlashCommand(text: string):
{
	name: string;
	rest: string;
} | null
{
	const match = LEADING_SLASH_COMMAND_RE.exec(text);
	const name = match?.[1];
	if (match === null || name === undefined) return null;
	return {
		name,
		rest: text.slice(match[0].length),
	};
}
