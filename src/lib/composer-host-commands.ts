import type {EffortLevel} from "./launch-options";

/** The chin menus a host command can open. */
export type HostCommandMenu = "model" | "effort" | "mode";

export interface HostCommandContext {
	/** Effort levels the current model offers; empty when it has no effort section. */
	effortLevels: readonly EffortLevel[];
	/** Model ids and aliases `/model <arg>` accepts. */
	models: readonly string[];
	/** False while the composer has no chin to open (picker locked or still loading). */
	menusAvailable: boolean;
}

export type HostCommand =
	| {kind: "open"; menu: HostCommandMenu; name: string}
	| {kind: "effort"; level: EffortLevel; name: string}
	| {kind: "model"; model: string; name: string}
	| {kind: "refuse"; toast: string}
	| {kind: "band"; text: string};

const MODEL_LOCKED = "Model can’t be changed for this session right now.";
const PERMISSION_LOCKED = "The permission mode can’t be changed for this session.";
const MODEL_COMMAND = /^\/model(?:[\s:,.]+(.*))?$/is;
const COMMAND_NAME = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/;
const SINGLE_WORD = /^[A-Za-z][A-Za-z0-9]*$/;
const PERMISSION_NAMES = ["permissions", "allowed-tools"];

/** How a sent host command is shaped: bare, with text after it, or spanning lines. */
export interface CommandShape {
	kind: "run" | "trailing_args" | "extra_lines";
	/** The command name as typed, lowercased. */
	name: string;
}

/**
 * Upstream's `KQ`: matches trimmed `text` against `/name` for one of `names`
 * (case-insensitive). Extra lines win over trailing arguments.
 */
export function parseCommandShape(names: readonly string[], text: string): CommandShape | null {
	const alternatives = names.map((name) => name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")).join("|");
	const match = new RegExp(`^\\/(${alternatives})(?=\\s|$)([\\s\\S]*)$`, "i").exec(text.trim());
	if (!match?.[1]) return null;
	const name = match[1].toLowerCase();
	const rest = match[2] ?? "";
	if (/[\r\n]/.test(rest)) return {kind: "extra_lines", name};
	return {kind: rest.trim() ? "trailing_args" : "run", name};
}

/** Upstream's rejectTrailingArguments body (`cgTRRpTLBX`). */
export function trailingArgsBody(name: string): string {
	return `/${name} doesn’t take arguments here. Remove the text after the command, then send it again.`;
}

/** Upstream's rejectExtraLines body (`hH0Sho9AXl`). */
export function extraLinesBody(name: string): string {
	return `/${name} only works on a single line. Remove the extra lines, then send it again.`;
}

/**
 * Upstream's host interception for `/model`, `/effort` and `/permissions`
 * (alias `/allowed-tools`): what sending `text` should do instead of reaching
 * the CLI, or null to send it as typed.
 */
export function parseHostCommand(text: string, ctx: HostCommandContext): HostCommand | null {
	const trimmed = text.trim();
	const modelMatch = MODEL_COMMAND.exec(trimmed);
	if (modelMatch) return parseModel(modelMatch[1]?.trim() ?? "", ctx);

	const match = COMMAND_NAME.exec(trimmed);
	if (!match?.[1]) return null;
	const name = match[1].toLowerCase();
	if (name === "effort") return parseEffort(match[2]?.trim() ?? "", name, ctx);
	const shape = parseCommandShape(PERMISSION_NAMES, trimmed);
	if (!shape) return null;
	if (shape.kind === "extra_lines") return {kind: "band", text: extraLinesBody(shape.name)};
	if (!ctx.menusAvailable) return {kind: "refuse", toast: PERMISSION_LOCKED};
	if (shape.kind === "trailing_args") return {kind: "band", text: trailingArgsBody(shape.name)};
	return {kind: "open", menu: "mode", name: shape.name};
}

function parseModel(arg: string, ctx: HostCommandContext): HostCommand {
	if (!ctx.menusAvailable) return {kind: "refuse", toast: MODEL_LOCKED};
	if (!arg) return {kind: "open", menu: "model", name: "model"};
	const known = ctx.models.find((model) => model.toLowerCase() === arg.toLowerCase());
	if (known) return {kind: "model", model: known, name: "model"};
	if (SINGLE_WORD.test(arg)) return {kind: "refuse", toast: `“${arg}” isn’t an available model.`};
	return {kind: "model", model: arg, name: "model"};
}

function parseEffort(arg: string, name: string, ctx: HostCommandContext): HostCommand | null {
	if (ctx.effortLevels.length === 0) return null;
	const level = ctx.effortLevels.find((candidate) => candidate === arg.toLowerCase());
	if (arg && !level) return null;
	if (!ctx.menusAvailable) {
		return {kind: "refuse", toast: `The model is still loading. Try /${name} again in a moment.`};
	}
	return level ? {kind: "effort", level, name} : {kind: "open", menu: "effort", name};
}
