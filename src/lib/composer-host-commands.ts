import type {EffortLevel} from "./launch-options";
import type {OutputStyleItem} from "./output-style-options";

/** The chin menus a host command can open. */
export type HostCommandMenu = "model" | "effort" | "mode";

export interface HostCommandContext
{
	/** Effort levels the current model offers; empty when it has no effort section. */
	effortLevels: readonly EffortLevel[];
	/** Model ids and aliases `/model <arg>` accepts. */
	models: readonly string[];
	/** False while the composer has no chin to open (picker locked or still loading). */
	menusAvailable: boolean;
}

export type HostCommand =
	|
	  {
			kind: "open";
			menu: HostCommandMenu;
			name: string;
	  }
	|
	  {
			kind: "effort";
			level: EffortLevel;
			name: string;
	  }
	|
	  {
			kind: "model";
			model: string;
			name: string;
	  }
	|
	  {
			kind: "refuse";
			toast: string;
	  }
	|
	  {
			kind: "band";
			text: string;
	  };

const MODEL_LOCKED = "Model can’t be changed for this session right now.";
const PERMISSION_LOCKED = "The permission mode can’t be changed for this session.";
const MODEL_COMMAND = /^\/model(?:[\s:,.]+(.*))?$/is;
const COMMAND_NAME = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/;
const SINGLE_WORD = /^[A-Za-z][A-Za-z0-9]*$/;
const PERMISSION_NAMES = ["permissions", "allowed-tools"];
/** Upstream's `ho`: the CLI's bare-word model aliases `/model` accepts even when no catalog id matches. */
const ACCEPTED_MODEL_WORDS: ReadonlySet<string> = new Set([
	"default",
	"best",
	"opusplan",
	"sonnet",
	"opus",
	"haiku",
	"fable",
	"mythos",
]);
/** A dated id's `-20YYMMDD` suffix (and any `[1m]` window after it), which upstream strips before matching. */
const DATE_SUFFIX = /-20\d{6}(\[[^\]]+\])?$/;

/** How a sent host command is shaped: bare, with text after it, or spanning lines. */
export interface CommandShape
{
	kind: "run" | "trailing_args" | "extra_lines";
	/** The command name as typed, lowercased. */
	name: string;
}

/**
 * Upstream's `KQ`: matches trimmed `text` against `/name` for one of `names`
 * (case-insensitive). Extra lines win over trailing arguments.
 */
export function parseCommandShape(names: readonly string[], text: string): CommandShape | null
{
	const alternatives = names.map((name) => name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")).join("|");
	const match = new RegExp(`^\\/(${alternatives})(?=\\s|$)([\\s\\S]*)$`, "i").exec(text.trim());
	if (!match?.[1]) return null;
	const name = match[1].toLowerCase();
	const rest = match[2] ?? "";
	if (/[\r\n]/.test(rest))
		return {
			kind: "extra_lines",
			name,
		};
	return {
		kind: rest.trim() ? "trailing_args" : "run",
		name,
	};
}

/** Upstream's `cr`: a sent command's `/name`, followed by whitespace or the end. */
export const SLASH_NAME = /^\/(\w[\w:-]*)(?=\s|$)/;

/**
 * Upstream's `Il` for the bare-only `context-popover` action: a bare `/autocompact`
 * (any case, surrounding whitespace allowed) opens the Context card; with an argument
 * (`auto`, a token count) it reaches the CLI as typed.
 */
export function autocompactCommand(text: string): "open" | null
{
	const trimmed = text.trim();
	const match = SLASH_NAME.exec(trimmed);
	if (match?.[1]?.toLowerCase() !== "autocompact") return null;
	return trimmed.slice(match[0].length).trim() === "" ? "open" : null;
}

/** What a sent `/skills` asks for: open the Skills list, or one of the two shape bands. */
export type SkillsCommandAction = "open" | "trailing_args" | "extra_lines";

const SKILLS_COMMAND = /^\/skills(?=\s|$)([\s\S]*)$/i;

/** Upstream's `Hpe`: the shape of a sent `/skills`, or null when it is not `/skills`. Only LF counts as a line break. */
export function skillsCommandAction(text: string): SkillsCommandAction | null
{
	const match = SKILLS_COMMAND.exec(text.trim());
	if (match === null) return null;
	const rest = match[1] ?? "";
	if (rest.includes("\n")) return "extra_lines";
	return rest.trim() === "" ? "open" : "trailing_args";
}

/**
 * Upstream's `Hpe` + `Upe` with pageAvailable always true (the local Skills page always exists): what the host
 * does with a sent `/skills`, or null to send it to the CLI as typed. When the CLI lists its own `/skills` and the
 * host row wasn't picked, only a bare `/skills` is the host's.
 */
export function routeSkillsCommand({
	text,
	cliListsOwn,
	hostRowPicked,
}: {
	text: string;
	cliListsOwn: boolean;
	hostRowPicked: boolean;
}): SkillsCommandAction | null
{
	const action = skillsCommandAction(text);
	if (action === null) return null;
	return hostRowPicked || !cliListsOwn || action === "open" ? action : null;
}

/** Upstream's rejectTrailingArguments body (`cgTRRpTLBX`). */
export function trailingArgsBody(name: string): string
{
	return `/${name} doesn’t take arguments here. Remove the text after the command, then send it again.`;
}

/** Upstream's rejectExtraLines body (`hH0Sho9AXl`). */
export function extraLinesBody(name: string): string
{
	return `/${name} only works on a single line. Remove the extra lines, then send it again.`;
}

/**
 * Upstream's host interception for `/model`, `/effort` and `/permissions`
 * (alias `/allowed-tools`): what sending `text` should do instead of reaching
 * the CLI, or null to send it as typed.
 */
export function parseHostCommand(text: string, ctx: HostCommandContext): HostCommand | null
{
	const trimmed = text.trim();
	const modelMatch = MODEL_COMMAND.exec(trimmed);
	if (modelMatch) return parseModel(modelMatch[1]?.trim() ?? "", ctx);

	const match = COMMAND_NAME.exec(trimmed);
	if (!match?.[1]) return null;
	const name = match[1].toLowerCase();
	if (name === "effort") return parseEffort(match[2]?.trim() ?? "", name, ctx);
	const shape = parseCommandShape(PERMISSION_NAMES, trimmed);
	if (!shape) return null;
	if (shape.kind === "extra_lines")
		return {
			kind: "band",
			text: extraLinesBody(shape.name),
		};
	if (!ctx.menusAvailable)
		return {
			kind: "refuse",
			toast: PERMISSION_LOCKED,
		};
	if (shape.kind === "trailing_args")
		return {
			kind: "band",
			text: trailingArgsBody(shape.name),
		};
	return {
		kind: "open",
		menu: "mode",
		name: shape.name,
	};
}

function parseModel(arg: string, ctx: HostCommandContext): HostCommand
{
	if (!ctx.menusAvailable)
		return {
			kind: "refuse",
			toast: MODEL_LOCKED,
		};
	if (!arg)
		return {
			kind: "open",
			menu: "model",
			name: "model",
		};
	const known = findModel(arg, ctx.models) ?? findModel(arg.replace(DATE_SUFFIX, ""), ctx.models);
	if (known)
		return {
			kind: "model",
			model: known,
			name: "model",
		};
	if (SINGLE_WORD.test(arg))
	{
		const word = arg.toLowerCase();
		if (ACCEPTED_MODEL_WORDS.has(word))
			return {
				kind: "model",
				model: word,
				name: "model",
			};
		return {
			kind: "refuse",
			toast: `“${arg}” isn’t an available model.`,
		};
	}
	return {
		kind: "model",
		model: arg,
		name: "model",
	};
}

function findModel(arg: string, models: readonly string[]): string | undefined
{
	return models.find((model) => model.toLowerCase() === arg.toLowerCase());
}

function parseEffort(arg: string, name: string, ctx: HostCommandContext): HostCommand | null
{
	if (ctx.effortLevels.length === 0) return null;
	const level = ctx.effortLevels.find((candidate) => candidate === arg.toLowerCase());
	if (arg && !level) return null;
	if (!ctx.menusAvailable)
	{
		return {
			kind: "refuse",
			toast: `The model is still loading. Try /${name} again in a moment.`,
		};
	}
	if (level)
		return {
			kind: "effort",
			level,
			name,
		};
	// Upstream's chin `requestOpen`: an Effort menu with one option or fewer opens the Model menu instead.
	return {
		kind: "open",
		menu: ctx.effortLevels.length <= 1 ? "model" : "effort",
		name,
	};
}

/** Upstream's `/login` catalog row and its `/logout` alias (terminal action `sign-in`). */
const SIGN_IN_COMMAND_NAMES = ["login", "logout"] as const;
/** Upstream's uniqueKey for the sign-in toast, so a repeat replaces the open one. */
export const SIGN_IN_COMMAND_KEY = "epitaxy-sign-in-command";
/** Upstream's `$h` fallback (`nWCSAd`) when the host name is missing or not a plain name. */
const UNKNOWN_HOST = "the computer running this session";
const HOST_NAME = /^[\w.-]{1,64}$/;

/** Upstream's bridged sign-in error (`88wELc`). */
export function signInCommandToast(name: string, host?: string): string
{
	const where = host !== undefined && HOST_NAME.test(host) ? host : UNKNOWN_HOST;
	return `To change this session’s sign-in, run /${name} in Claude Code on ${where}.`;
}

export type SignInCommand =
	|
	  {
			kind: "sign-in";
			toast: string;
	  }
	|
	  {
			kind: "band";
			text: string;
	  };

/**
 * Upstream's `sign-in` terminal action for a Remote Control session: a bare `/login` or `/logout` gets the
 * bridged error toast, text after it or extra lines get their bands, and anything else is null.
 */
export function parseSignInCommand(text: string): SignInCommand | null
{
	const shape = parseCommandShape(SIGN_IN_COMMAND_NAMES, text);
	if (shape === null) return null;
	if (shape.kind === "run")
		return {
			kind: "sign-in",
			toast: signInCommandToast(shape.name),
		};
	return {
		kind: "band",
		text: shape.kind === "extra_lines" ? extraLinesBody(shape.name) : trailingArgsBody(shape.name),
	};
}

/** Upstream's uniqueKey for the `/fast` no-op notice, so a repeat re-shows one toast instead of "(×2)". */
export const FAST_COMMAND_NOTICE_KEY = "epitaxy-fast-command-notice";

/** What a sent `/fast [on|off]` does: nothing new, flip fast mode, or reach the CLI as typed. */
export type FastCommandRoute = "noop" | "toggle" | "unhandled";

/**
 * Upstream's `UQ`: an argument other than on/off, or no fast toggle on this model,
 * goes to the CLI; asking for the current state is a no-op; anything else toggles.
 */
export function routeFastCommand({
	arg,
	on,
	canToggle,
}: {
	arg: string;
	on: boolean;
	canToggle: boolean;
}): FastCommandRoute
{
	const word = arg.toLowerCase();
	if (!canToggle || (word !== "" && word !== "on" && word !== "off")) return "unhandled";
	return word !== "" && (word === "on") === on ? "noop" : "toggle";
}

/** The trimmed argument after `/fast` (case-insensitive), or null when `text` isn't a `/fast` command. */
export function fastCommandArg(text: string): string | null
{
	const match = COMMAND_NAME.exec(text.trim());
	if (match?.[1]?.toLowerCase() !== "fast") return null;
	return match[2]?.trim() ?? "";
}

/** Upstream's uniqueKey for the two "Already in plan mode" notices, so the second replaces the first. */
export const PLAN_COMMAND_NOTICE_KEY = "epitaxy-plan-command-notice";

/** Upstream's uniqueKey for the "Plan mode isn’t available" error toast. */
export const PLAN_COMMAND_UNAVAILABLE_KEY = "epitaxy-plan-command-unavailable";

/** Upstream's `Xle`: `/plan` with an optional argument that may span lines. */
const PLAN_COMMAND = /^\/plan(?:\s+([\s\S]*))?$/i;

/** The trimmed argument after `/plan`, `""` when bare, or null when `text` isn't `/plan` (`/plans` isn't). */
export function planCommandArg(text: string): string | null
{
	const match = PLAN_COMMAND.exec(text.trim());
	if (match === null) return null;
	return match[1]?.trim() ?? "";
}

export type PlanCommandNotice = "already_in_plan" | "already_in_plan_no_plan";

export type PlanCommandRoute =
	|
	  {
			kind: "unavailable";
	  }
	|
	  {
			kind: "command_like";
	  }
	|
	  {
			kind: "run";
			switchToPlan: boolean;
			openPane: boolean;
			notice: PlanCommandNotice | null;
			send: string | null;
	  };

/** Upstream's `_d`: a leading `/name` followed by whitespace, `:`, `,`, `.` or the end. */
const COMMAND_LIKE = /^\/[\w:-]+(?=[\s:,.]|$)/;
const INVISIBLE = /[\p{Cf}\u034f\u115f\u1160\u3164\uffa0]/gu;
const LEADING_INVISIBLE = /^[\s\p{Cf}]+/u;

/** Upstream's `Qle`: an argument other than `open`/`share` (any case) is a description. */
function isPlanDescription(arg: string): boolean
{
	const word = arg.toLowerCase();
	return word !== "" && word !== "open" && word !== "share";
}

function isCommandLike(arg: string, cliListsCommand: (name: string) => boolean): boolean
{
	return [arg, arg.replace(INVISIBLE, "")].some((variant) =>
	{
		const text = variant.replace(LEADING_INVISIBLE, "");
		if (COMMAND_LIKE.test(text) || text.startsWith("!")) return true;
		const name = /^\/(\S+)/.exec(text)?.[1];
		return name !== undefined && cliListsCommand(name);
	});
}

/**
 * Upstream's `Zle`: what a sent `/plan [open|share|<description>]` does. A description switches to plan
 * mode first unless already there, then goes out as an ordinary prompt; a bare `/plan` switches, opens the
 * Plan pane when there is (or may be) a plan to show, or says it's already in plan mode.
 */
export function routePlanCommand({
	arg,
	currentMode,
	planSelectable,
	hasPlan,
	olderMessagesNotLoaded,
	canOpenPane,
	paneAlreadyOpen,
	cliListsCommand,
}: {
	arg: string;
	currentMode: string;
	planSelectable: boolean;
	hasPlan: boolean;
	olderMessagesNotLoaded: boolean;
	canOpenPane: boolean;
	paneAlreadyOpen: boolean;
	cliListsCommand: (name: string) => boolean;
}): PlanCommandRoute
{
	const mayHavePlan = hasPlan || olderMessagesNotLoaded;
	const inPlan = currentMode === "plan";
	const description = isPlanDescription(arg);
	const openPane = mayHavePlan && canOpenPane && !paneAlreadyOpen;
	if (!inPlan && !planSelectable)
	{
		if (description || !openPane)
			return {
				kind: "unavailable",
			};
		return {
			kind: "run",
			switchToPlan: false,
			openPane: true,
			notice: null,
			send: null,
		};
	}
	if (description)
	{
		if (isCommandLike(arg, cliListsCommand))
			return {
				kind: "command_like",
			};
		return {
			kind: "run",
			switchToPlan: !inPlan,
			openPane: false,
			notice: null,
			send: arg,
		};
	}
	let notice: PlanCommandNotice | null = null;
	if (inPlan && !openPane) notice = mayHavePlan ? "already_in_plan" : "already_in_plan_no_plan";
	return {
		kind: "run",
		switchToPlan: !inPlan,
		openPane,
		notice,
		send: null,
	};
}

/** What a sent `/status` does: draw the Session info card, toast why it can't yet, or band the extra text. */
export type StatusCommandRoute =
	|
	  {
			kind: "card";
	  }
	|
	  {
			kind: "notice";
			/** What clears the notice: the session starting, or the running turn ending (upstream's `cause`). */
			cause: "session" | "turn";
			text: string;
	  }
	|
	  {
			kind: "band";
			text: string;
	  };

/**
 * Upstream's `/status` dispatch (`IOe` then `showStatusReport`): the shape bands first, then no session
 * (the home draft) or a running turn shows the composer's spawn notice and keeps the text; otherwise the card. Null when `text`
 * isn't `/status`.
 */
export function routeStatusCommand(
	text: string,
	{
		hasSession,
		turnActive,
	}:
	{
		hasSession: boolean;
		turnActive: boolean;
	},
): StatusCommandRoute | null
{
	const shape = parseCommandShape(["status"], text);
	if (shape === null) return null;
	if (shape.kind === "extra_lines")
		return {
			kind: "band",
			text: extraLinesBody(shape.name),
		};
	if (shape.kind === "trailing_args")
		return {
			kind: "band",
			text: trailingArgsBody(shape.name),
		};
	if (!hasSession)
		return {
			kind: "notice",
			cause: "session",
			text: "Session info is available once the session starts.",
		};
	if (turnActive)
		return {
			kind: "notice",
			cause: "turn",
			text: "Session info is available when Claude finishes this turn.",
		};
	return {
		kind: "card",
	};
}

/** What a sent `/usage` or `/cost` does: draw the Usage card, open Settings › Usage, or band the extra text. */
export type UsageCommandRoute =
	|
	  {
			kind: "card";
			text: string;
	  }
	|
	  {
			kind: "settings";
	  }
	|
	  {
			kind: "band";
			text: string;
	  };

/**
 * Upstream's `/usage` dispatch (`W3(["usage","cost"])` then `py`): the shape bands first; then a session with no
 * running turn gets the card for the command as typed, and the home draft or a running turn opens Settings › Usage.
 * Null when `text` isn't `/usage` or `/cost` (`/stats` goes to the CLI).
 */
export function routeUsageCommand(
	text: string,
	{
		hasSession,
		turnActive,
	}:
	{
		hasSession: boolean;
		turnActive: boolean;
	},
): UsageCommandRoute | null
{
	const shape = parseCommandShape(["usage", "cost"], text);
	if (shape === null) return null;
	if (shape.kind === "extra_lines")
		return {
			kind: "band",
			text: extraLinesBody(shape.name),
		};
	if (shape.kind === "trailing_args")
		return {
			kind: "band",
			text: trailingArgsBody(shape.name),
		};
	if (!hasSession || turnActive)
		return {
			kind: "settings",
		};
	return {
		kind: "card",
		text: text.trim(),
	};
}

/**
 * Upstream's `/output-style` submit outcomes: `home` is the no-session warning with its "Open settings" action,
 * `refuse` toasts and keeps the text, `open` clears it and opens the picker, `already` clears it with a success
 * toast, and `send` hands the canonical command to the CLI, which switches and saves the style.
 */
export type OutputStyleCommand =
	|
	  {
			kind: "home" | "refuse" | "already";
			message: string;
	  }
	|
	  {
			kind: "open";
	  }
	|
	  {
			kind: "send";
			text: string;
	  };

const OUTPUT_STYLE_COMMAND = /^\/output-style(?:[\s:,.]+(.*))?$/is;

/**
 * Upstream's `/output-style` intercept, in its order: before the session starts, while its styles load, with no
 * styles, bare, then an argument matched by exact name, case-insensitive name, then case-insensitive label.
 */
export function parseOutputStyleCommand(
	text: string,
	items: readonly OutputStyleItem[] | undefined,
	ctx:
	{
		hasSession: boolean;
		booting: boolean;
	},
): OutputStyleCommand | null
{
	const match = OUTPUT_STYLE_COMMAND.exec(text.trim());
	if (match === null) return null;
	if (!ctx.hasSession)
		return {
			kind: "home",
			message: "Set the output style in settings. This session uses it when it starts.",
		};
	if (ctx.booting)
		return {
			kind: "refuse",
			message: "Output styles haven’t loaded yet. Try again in a moment.",
		};
	if (items === undefined)
		return {
			kind: "refuse",
			message: "Output styles aren’t available for this session.",
		};
	const value = (match[1] ?? "").trim();
	if (value === "")
		return {
			kind: "open",
		};
	const folded = value.toLowerCase();
	const item =
		items.find((candidate) => candidate.name === value) ??
		items.find((candidate) => candidate.name.toLowerCase() === folded) ??
		items.find((candidate) => candidate.label.toLowerCase() === folded);
	if (item === undefined)
		return {
			kind: "refuse",
			message: `“${value}” isn’t an available output style.`,
		};
	if (item.checked)
		return {
			kind: "already",
			message: `Output style already set to ${item.label}.`,
		};
	return {
		kind: "send",
		text: `/output-style ${item.name}`,
	};
}

/** Upstream's `/memory` test (`jf`): the name, then whitespace or the end, so arguments are taken too. */
export function isMemoryCommand(text: string): boolean
{
	return /^\/memory(?:\s|$)/i.test(text.trim());
}

/** Upstream's `/mcp` test: only the exact command; anything after it reaches the CLI. */
export function isMcpCommand(text: string): boolean
{
	return text.trim() === "/mcp";
}
