/**
 * Parser for the CLI's hook-block notices (upstream cee3384c5 export `s`).
 * A UserPromptSubmit/UserPromptExpansion hook that blocks a prompt leaves a
 * `system/informational` record whose content this splits into the hook's
 * reason and the prompt it stopped.
 */

import {maskAndCap} from "./secret-mask";

export type HookMessage =
	|
	  {
			kind: "blocked";
			label: string;
			reason: string;
			originalPrompt?: string;
	  }
	|
	  {
			kind: "stopped";
			label: string;
			reason: string;
	  };

const BLOCKED_PATTERN = /^(?:UserPromptSubmit|UserPromptExpansion) operation blocked by hook:/;
const ORIGINAL_PROMPT_SEPARATOR = "\n\nOriginal prompt: ";
const STOPPED_PREFIX = "Operation stopped by hook";

export function parseHookMessage(text: string): HookMessage | null
{
	const match = BLOCKED_PATTERN.exec(text);
	if (match)
	{
		const label = match[0].slice(0, -1);
		const rest = text.slice(match[0].length);
		const separator = rest.indexOf(ORIGINAL_PROMPT_SEPARATOR);
		return separator === -1
			?
				{
					kind: "blocked",
					label,
					reason: rest.trim(),
				}
			:
				{
					kind: "blocked",
					label,
					reason: rest.slice(0, separator).trim(),
					originalPrompt: rest.slice(separator + ORIGINAL_PROMPT_SEPARATOR.length),
				};
	}
	if (text.startsWith(STOPPED_PREFIX))
	{
		return {
			kind: "stopped",
			label: STOPPED_PREFIX,
			reason: text.slice(STOPPED_PREFIX.length).replace(/^:\s*/, "").trim(),
		};
	}
	return null;
}

/** Upstream `AK` on card and marker details: secrets masked, then capped at 262144 chars plus `…`. */
export function capDetails(text: string): string
{
	return maskAndCap(text);
}
