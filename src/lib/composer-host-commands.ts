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
const PERMISSION_NAMES = new Set(["permissions", "allowed-tools"]);

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
	const arg = match[2]?.trim() ?? "";
	if (name === "effort") return parseEffort(arg, name, ctx);
	if (!PERMISSION_NAMES.has(name)) return null;
	if (trimmed.includes("\n")) {
		return {
			kind: "band",
			text: `/${name} only works on a single line. Remove the extra lines, then send it again.`,
		};
	}
	if (!ctx.menusAvailable) return {kind: "refuse", toast: PERMISSION_LOCKED};
	if (arg) {
		return {
			kind: "band",
			text: `/${name} doesn’t take arguments here. Remove the text after the command, then send it again.`,
		};
	}
	return {kind: "open", menu: "mode", name};
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
