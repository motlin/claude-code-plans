import {isRecord} from "./narrow";

/** The settings.json keys that decide whether a fresh session starts in fast mode. */
export interface FastModeSettings
{
	fastMode?: boolean | undefined;
	fastModePerSessionOptIn?: boolean | undefined;
}

/** The `message.usage.speed` of a main-thread assistant transcript entry, if it carries one. */
function assistantSpeed(entry: unknown): string | null
{
	if (!isRecord(entry) || entry["type"] !== "assistant" || entry["isSidechain"] === true) return null;
	const message = entry["message"];
	if (!isRecord(message)) return null;
	const usage = message["usage"];
	if (!isRecord(usage)) return null;
	const speed = usage["speed"];
	return typeof speed === "string" ? speed : null;
}

/**
 * Whether a session is in fast mode: the last main-thread assistant turn's `usage.speed`
 * ("fast" / "standard"), or, before any turn, settings.json `fastMode` unless it is a per-session opt-in.
 */
export function sessionFastMode(entries: readonly unknown[], settings: FastModeSettings): boolean
{
	for (let i = entries.length - 1; i >= 0; i--)
	{
		const speed = assistantSpeed(entries[i]);
		if (speed !== null) return speed === "fast";
	}
	return settings.fastMode === true && settings.fastModePerSessionOptIn !== true;
}

/** Why the CLI can't use fast mode in a session, as the Model menu's blocked row shows it. */
export interface FastModeBlocked
{
	/** The row's second line. */
	line: string;
	/** The reason tooltip; upstream shows none for some codes. */
	reason?: string | undefined;
}

export interface FastModeBlockedReason extends FastModeBlocked
{
	/** The CLI's `fast_mode_disabled_reason`. */
	code: "not_first_party" | "disabled_by_env" | "preference";
}

export interface FastModeBlockSources
{
	/** The CLI's environment: settings.json `env` merged over the server's own. */
	env?: Readonly<Record<string, string | undefined>>;
	/** Managed (policy) settings. */
	policy?:
	{
		fastMode?: boolean | undefined;
	};
}

/** The CLI's env truthiness rule. */
function envTruthy(value: string | undefined): boolean
{
	return value !== undefined && ["1", "true", "yes", "on"].includes(value.toLowerCase().trim());
}

const THIRD_PARTY_PROVIDER_ENV = ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"];

/**
 * The CLI's fast-mode disabled reason for a desktop-local session, mapped to upstream's row copy: a third-party
 * provider first, then `CLAUDE_CODE_DISABLE_FAST_MODE`, then a managed policy `fastMode: false`.
 */
export function fastModeBlockedReason({env = {}, policy}: FastModeBlockSources): FastModeBlockedReason | null
{
	if (THIRD_PARTY_PROVIDER_ENV.some((name) => envTruthy(env[name])))
	{
		return {
			code: "not_first_party",
			line: "Not available with this provider",
			reason: "Fast mode is only available when Claude Code uses the Claude API directly.",
		};
	}
	if (envTruthy(env["CLAUDE_CODE_DISABLE_FAST_MODE"]))
	{
		return {
			code: "disabled_by_env",
			line: "Off for this session",
			reason: "An environment variable turns fast mode off in this session.",
		};
	}
	if (policy?.fastMode === false)
		return {
			code: "preference",
			line: "Not available",
		};
	return null;
}
