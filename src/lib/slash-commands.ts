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

/**
 * Empty query: the built-ins only. Otherwise every command whose name or
 * description contains the query, ranked name prefix > name contains >
 * description contains, keeping list order within a rank.
 */
export function filterSlashCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
	if (query === "") return commands.filter((command) => command.source === "builtin");
	const needle = query.toLowerCase();
	const ranks: SlashCommand[][] = [[], [], []];
	for (const command of commands) {
		const name = command.name.toLowerCase();
		if (name.startsWith(needle)) ranks[0]?.push(command);
		else if (name.includes(needle)) ranks[1]?.push(command);
		else if (command.description.toLowerCase().includes(needle)) ranks[2]?.push(command);
	}
	return ranks.flat();
}

export interface HighlightSegment {
	text: string;
	match: boolean;
}

/** Splits `text` around every case-insensitive occurrence of `query`. */
export function highlightMatches(text: string, query: string): HighlightSegment[] {
	if (query === "") return [{text, match: false}];
	const haystack = text.toLowerCase();
	const needle = query.toLowerCase();
	const segments: HighlightSegment[] = [];
	let start = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		if (index > start) segments.push({text: text.slice(start, index), match: false});
		segments.push({text: text.slice(index, index + needle.length), match: true});
		start = index + needle.length;
		index = haystack.indexOf(needle, start);
	}
	if (start < text.length) segments.push({text: text.slice(start), match: false});
	return segments;
}

/** The partial command name while the prompt is just `/` plus one token, else null. */
export function slashQuery(prompt: string): string | null {
	const match = /^\/(\S*)$/.exec(prompt);
	return match === null ? null : (match[1] ?? "");
}

/** The argument-hint ghost text for a just-accepted `/name ` with no arguments yet. */
export function slashArgumentHint(commands: readonly SlashCommand[], prompt: string): string | null {
	const match = /^\/(\S+) $/.exec(prompt);
	if (match === null) return null;
	return commands.find((command) => command.name === match[1])?.argumentHint ?? null;
}
