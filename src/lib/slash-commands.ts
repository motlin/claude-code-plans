/**
 * Composer "/" autocomplete: the curated CLI built-ins plus the pure merge,
 * ranking and highlight logic shared by the popup and `GET /api/commands`.
 */

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

export interface SlashCommand {
	name: string;
	description: string;
	source: SlashCommandSource;
	argumentHint?: string | undefined;
	/** Other names the command answers to, ranked and shown as a muted `(alias)` suffix as upstream does. */
	aliases?: readonly string[] | undefined;
	/** The plugin a plugin skill or command comes from; upstream labels the row by the bare name and names the plugin beside it. */
	pluginName?: string | undefined;
	/**
	 * A user, project or plugin entry whose name or alias collides with a built-in. Upstream lists it as a
	 * second row tagged "Custom command" and routes it with `slashRouting:"cli"`; locally both rows insert
	 * the same `/name` and the CLI decides.
	 */
	shadowsHost?: true | undefined;
}

/** One row of the "/" popup, mirroring upstream's `SlashCommandMenuPopupBody` item types. */
export type SlashMenuItem =
	| {type: "command"; command: SlashCommand}
	| {type: "section-header"; label: string}
	| {type: "separator"}
	| {type: "loading"};

/** Upstream's `bB`: ↑/↓ skip headers, separators and the loading row. */
function isSelectableSlashItem(item: SlashMenuItem): item is {type: "command"; command: SlashCommand} {
	return item.type === "command";
}

/**
 * The highlight after ↑/↓ (`move` ±1) from `current`, skipping unselectable items and
 * clamping at both ends; from nothing highlighted (-1), ↓ picks the first row and ↑ the last.
 */
export function stepSlashHighlight(items: readonly SlashMenuItem[], current: number, move: 1 | -1): number {
	const selectable = items.flatMap((item, index) => (isSelectableSlashItem(item) ? [index] : []));
	if (current === -1) return (move === 1 ? selectable[0] : selectable.at(-1)) ?? -1;
	const next =
		move === 1 ? selectable.find((index) => index > current) : selectable.findLast((index) => index < current);
	return next ?? current;
}

/** The first selectable item, or -1 when none is. */
export function firstSlashHighlight(items: readonly SlashMenuItem[]): number {
	return stepSlashHighlight(items, -1, 1);
}

/** Keeps a remembered highlight on a selectable item after the list shrinks. */
export function clampSlashHighlight(items: readonly SlashMenuItem[], index: number): number {
	if (index === -1) return -1;
	const selectable = items.flatMap((item, i) => (isSelectableSlashItem(item) ? [i] : []));
	return selectable.find((i) => i >= index) ?? selectable.at(-1) ?? -1;
}

/** The row label: a plugin entry's name without its `plugin:` namespace, as upstream shows plugin skills. */
export function slashCommandLabel(command: SlashCommand): string {
	const prefix = command.pluginName === undefined ? undefined : `${command.pluginName}:`;
	return prefix !== undefined && command.name.startsWith(prefix) ? command.name.slice(prefix.length) : command.name;
}

/**
 * claude.ai/code's locally meaningful built-ins with its exact strings, hints and
 * aliases, followed by the local-only CLI built-ins.
 */
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommand[] = [
	{name: "model", description: "Set the model for this session", source: "builtin", argumentHint: "[model-id]"},
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
	/* Local-only built-ins with no claude.ai/code row. */
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
];

/*
 * Every built-in name and alias the CLI answers to, plus its bundled skills, so a mistyped
 * `/name` can be told apart from a real command. Seeded from CLI 2.1.310 with
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
export function isKnownSlashCommand(name: string, slashCommands: readonly SlashCommand[]): boolean {
	const needle = name.toLowerCase();
	if (CLI_COMMAND_NAMES.has(needle)) return true;
	return slashCommands.some((command) =>
		[command.name, command.name.slice(command.name.lastIndexOf(":") + 1), ...(command.aliases ?? [])].some(
			(label) => label.toLowerCase() === needle,
		),
	);
}

/**
 * Flattens groups given in precedence order; the first entry for a name wins, except that the first
 * non-built-in entry colliding with a built-in's name or alias is also kept, marked `shadowsHost`.
 */
export function mergeSlashCommands(groups: readonly (readonly SlashCommand[])[]): SlashCommand[] {
	const builtinNames = new Set(
		groups
			.flat()
			.flatMap((command) => (command.source === "builtin" ? [command.name, ...(command.aliases ?? [])] : [])),
	);
	const seen = new Set<string>();
	const seenShadows = new Set<string>();
	const merged: SlashCommand[] = [];
	for (const group of groups) {
		for (const command of group) {
			const collides =
				command.source !== "builtin" &&
				[command.name, ...(command.aliases ?? [])].some((name) => builtinNames.has(name));
			if (collides) {
				if (seenShadows.has(command.name)) continue;
				seenShadows.add(command.name);
				merged.push({...command, shadowsHost: true});
				continue;
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

/* Upstream's synchronous fallback tiers (`W$`), plus a description tier the local menu matches synchronously. */
function slashRank(command: SlashCommand, needle: string): number | null {
	/* A plugin entry ranks by its bare label, and its `plugin:name` still matches. */
	const names = [...new Set([slashCommandLabel(command), command.name])].map((name) => name.toLowerCase());
	const aliases = (command.aliases ?? []).map((alias) => alias.toLowerCase());
	if (names.includes(needle)) return 0;
	if (aliases.includes(needle)) return 1;
	if (names.some((name) => name.startsWith(needle))) return 2;
	if (aliases.some((alias) => alias.startsWith(needle))) return 3;
	if ([...names, ...aliases].some((label) => label.includes(needle))) return 4;
	if (command.description.toLowerCase().includes(needle)) return 5;
	return null;
}

/**
 * Empty query: every command in list order, as upstream does. Otherwise every command whose name, alias or description
 * contains the query, ranked exact name > exact alias > name prefix > alias prefix >
 * name or alias contains > description contains, keeping list order within a rank.
 */
export function filterSlashCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
	if (query === "") return [...commands];
	if (query.length > MAX_SLASH_QUERY_LENGTH) return [];
	const needle = query.toLowerCase();
	const ranks: SlashCommand[][] = [[], [], [], [], [], []];
	for (const command of commands) {
		const rank = slashRank(command, needle);
		if (rank !== null) ranks[rank]?.push(command);
	}
	return ranks.flat();
}

/** The first alias that starts with the query, which upstream appends to the row as `(alias)`. */
export function matchingAlias(command: SlashCommand, query: string): string | undefined {
	if (query === "") return undefined;
	const needle = query.toLowerCase();
	return command.aliases?.find((alias) => alias.toLowerCase().startsWith(needle));
}

export interface HighlightSegment {
	text: string;
	match: boolean;
}

/** Splits `text` around the first case-insensitive occurrence of `query`, as upstream bolds only the first match. */
export function highlightMatches(text: string, query: string): HighlightSegment[] {
	const index = query === "" ? -1 : text.toLowerCase().indexOf(query.toLowerCase());
	if (index === -1) return [{text, match: false}];
	const end = index + query.length;
	const segments: HighlightSegment[] = [];
	if (index > 0) segments.push({text: text.slice(0, index), match: false});
	segments.push({text: text.slice(index, end), match: true});
	if (end < text.length) segments.push({text: text.slice(end), match: false});
	return segments;
}

export interface SlashTrigger {
	/** Index of the `/` in the prompt. */
	start: number;
	query: string;
	/** True only at the very start of the prompt, where upstream opens with row 0 highlighted. */
	atStart: boolean;
}

/**
 * The `/query` token ending at the caret, or null. Upstream opens on a `/` at the start of the
 * prompt (selected) or after whitespace (unselected, and only once the query is non-empty).
 */
export function slashTrigger(prompt: string, caret: number): SlashTrigger | null {
	if (/^\S/.test(prompt.slice(caret))) return null;
	const match = /(?:^|\s)\/([^\s/]*)$/.exec(prompt.slice(0, caret));
	if (match === null) return null;
	const query = match[1] ?? "";
	const start = caret - query.length - 1;
	const atStart = start === 0;
	if (!atStart && query === "") return null;
	return {start, query, atStart};
}

/** Upstream `skillChipArgumentHint` gives up past this doc size. */
const SKILL_CHIP_HINT_MAX_LENGTH = 128;

/**
 * An accepted chip's argument hint, shown as upstream's `skillChipArgumentHint` does: only whitespace
 * after the chip, and at least one space or tab right after it on the chip's own line.
 */
export function skillChipArgumentHint(
	chip: {name: string; argumentHint: string | undefined},
	prompt: string,
): string | null {
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
export function splitLeadingSlashCommand(text: string): {name: string; rest: string} | null {
	const match = LEADING_SLASH_COMMAND_RE.exec(text);
	const name = match?.[1];
	if (match === null || name === undefined) return null;
	return {name, rest: text.slice(match[0].length)};
}
