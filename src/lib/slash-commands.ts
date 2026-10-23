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
}

/** The row label: a plugin entry's name without its `plugin:` namespace, as upstream shows plugin skills. */
export function slashCommandLabel(command: SlashCommand): string {
	const prefix = command.pluginName === undefined ? undefined : `${command.pluginName}:`;
	return prefix !== undefined && command.name.startsWith(prefix) ? command.name.slice(prefix.length) : command.name;
}

/**
 * CLI built-ins that make sense against a local session, with claude.ai/code
 * tooltip wording where upstream has one. The empty-query list shows only these.
 */
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommand[] = [
	{
		name: "btw",
		description: "Ask a quick side question without adding to the session",
		source: "builtin",
		argumentHint: "<question>",
	},
	{
		name: "model",
		description: "Set the model for this session",
		source: "builtin",
		argumentHint: "[model]",
	},
	{
		name: "effort",
		description: "Set the effort level for this session",
		source: "builtin",
		argumentHint: "[low|medium|high|xhigh|max]",
	},
	{
		name: "plan",
		description: "Switch to plan mode or view this session’s plan",
		source: "builtin",
	},
	{name: "permissions", description: "Change the permission mode", source: "builtin"},
	{
		name: "rename",
		description: "Rename this session",
		source: "builtin",
		argumentHint: "[name]",
	},
	{
		name: "status",
		description: "Show this session’s version, model, environment, and account",
		source: "builtin",
	},
	{name: "usage", description: "Show plan usage and rate limits", source: "builtin"},
	{
		name: "compact",
		description: "Clear conversation history but keep a summary in context",
		source: "builtin",
		argumentHint: "[instructions]",
	},
	{
		name: "clear",
		description: "Clear conversation history and free up context",
		source: "builtin",
	},
	{name: "context", description: "Show current context usage", source: "builtin"},
	{name: "review", description: "Review a pull request", source: "builtin", argumentHint: "[pr]"},
	{
		name: "init",
		description: "Initialize a new CLAUDE.md file with codebase documentation",
		source: "builtin",
	},
];

/** User-authored commands carry upstream's muted "Custom command" tag. */
export function isCustomCommand(source: SlashCommandSource): boolean {
	return source === "personal-command" || source === "project-command";
}

/** Flattens groups given in precedence order; the first entry for a name wins. */
export function mergeSlashCommands(groups: readonly (readonly SlashCommand[])[]): SlashCommand[] {
	const seen = new Set<string>();
	const merged: SlashCommand[] = [];
	for (const group of groups) {
		for (const command of group) {
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
 * Empty query: the built-ins only. Otherwise every command whose name, alias or description
 * contains the query, ranked exact name > exact alias > name prefix > alias prefix >
 * name or alias contains > description contains, keeping list order within a rank.
 */
export function filterSlashCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
	if (query === "") return commands.filter((command) => command.source === "builtin");
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

/** The argument-hint ghost text for a just-accepted `/name ` with no arguments yet. */
export function slashArgumentHint(commands: readonly SlashCommand[], prompt: string): string | null {
	const match = /^\/(\S+) $/.exec(prompt);
	if (match === null) return null;
	return commands.find((command) => command.name === match[1])?.argumentHint ?? null;
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
