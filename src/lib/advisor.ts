/**
 * The `/advisor` host dialog's model: upstream's option list, its model-id mapping (`gi`), its bare-command
 * test (`Kae`), and the session's current advisor read from the transcript instead of a `get_settings` request.
 */
import {isRecord} from "./narrow";
import {SYNTHETIC_MODEL} from "./model-name";

/** Upstream's `b`, the CLI's `[...advisorModelAliases, "off"]`. */
export const ADVISOR_OPTIONS = ["fable", "opus", "sonnet", "off"] as const;

export type AdvisorOption = (typeof ADVISOR_OPTIONS)[number];

/** The catalog row's and the CLI's `argumentHint`. */
export const ADVISOR_ARGUMENT_HINT = `[${ADVISOR_OPTIONS.join("|")}]`;

/** Upstream's `Iwe`: "Off", else the option capitalised. */
export function advisorOptionLabel(option: AdvisorOption): string
{
	return option === "off" ? "Off" : `${option.charAt(0).toUpperCase()}${option.slice(1)}`;
}

/**
 * Upstream's `gi`: unknown stays unknown, null (no advisor) is "off", and a model id picks the first of
 * fable/opus/sonnet that is one of its tokens; an unrecognised id is unknown.
 */
export function advisorOptionFor(model: string | null | undefined): AdvisorOption | undefined
{
	if (model === undefined) return undefined;
	if (model === null) return "off";
	const tokens = new Set(model.toLowerCase().split(/[^a-z0-9]+/));
	return ADVISOR_OPTIONS.find((option) => option !== "off" && tokens.has(option));
}

/** Upstream's `Kae`: only a bare `/advisor` opens the dialog; with arguments it reaches the CLI as typed. */
export function isBareAdvisorCommand(text: string): boolean
{
	return /^\/advisor$/i.test(text.trim());
}

/**
 * The session's advisor model, standing in for upstream's `get_settings` `applied.advisor`: the last main-thread
 * assistant turn's `advisorModel` (null when that turn ran without one, as the CLI writes the field only while an
 * advisor is on), else settings.json `advisorModel` before the first turn, else unknown.
 */
export function sessionAdvisorModel(
	entries: readonly unknown[],
	settings:
	{
		advisorModel?: string | null | undefined;
	},
): string | null | undefined
{
	for (let i = entries.length - 1; i >= 0; i--)
	{
		const entry = entries[i];
		if (!isRecord(entry) || entry["type"] !== "assistant" || entry["isSidechain"] === true) continue;
		const message = entry["message"];
		if (isRecord(message) && message["model"] === SYNTHETIC_MODEL) continue;
		const advisor = entry["advisorModel"];
		return typeof advisor === "string" ? advisor : null;
	}
	return settings.advisorModel ?? undefined;
}
