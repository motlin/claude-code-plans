import {isRecord} from "./narrow";

/** The settings.json keys that decide whether a fresh session starts in fast mode. */
export interface FastModeSettings
{
	fastMode?: boolean | undefined;
	fastModePerSessionOptIn?: boolean | undefined;
}

/** A main-thread (not sidechain) assistant transcript entry. */
function mainAssistant(entry: unknown): Record<string, unknown> | null
{
	return isRecord(entry) && entry["type"] === "assistant" && entry["isSidechain"] !== true ? entry : null;
}

/** The `message.usage.speed` of a main-thread assistant transcript entry, if it carries one. */
function assistantSpeed(entry: unknown): string | null
{
	const message = mainAssistant(entry)?.["message"];
	if (!isRecord(message)) return null;
	const usage = message["usage"];
	if (!isRecord(usage)) return null;
	const speed = usage["speed"];
	return typeof speed === "string" ? speed : null;
}

/** The CLI's live fast-mode toggle from the statusline snapshot, and when that snapshot was written. */
export interface LiveFastMode
{
	/** Statusline `fast_mode`; undefined from a CLI that doesn't send it. */
	fastMode: boolean | undefined;
	/** `statuslineUpdatedAt`. */
	updatedAt: string | null;
}

/**
 * The statusline's `fast_mode` when the snapshot is at least as new as the newest main-thread assistant entry,
 * else null (no key, no snapshot, or a stale snapshot from before the last turn).
 */
function currentLiveFastMode(entries: readonly unknown[], live: LiveFastMode | undefined): boolean | null
{
	if (live?.fastMode === undefined || live.updatedAt === null) return null;
	const liveAt = Date.parse(live.updatedAt);
	if (Number.isNaN(liveAt)) return null;
	for (let i = entries.length - 1; i >= 0; i--)
	{
		const timestamp = mainAssistant(entries[i])?.["timestamp"];
		if (typeof timestamp !== "string") continue;
		return Date.parse(timestamp) > liveAt ? null : live.fastMode;
	}
	return live.fastMode;
}

/**
 * Whether a session is in fast mode: statusline `fast_mode` (the CLI's toggle; on during a rate-limit cooldown,
 * matching upstream's `on||cooldown`) when newer than the last turn, else the last main-thread assistant turn's
 * `usage.speed` ("fast" / "standard"), else settings.json `fastMode` unless it is a per-session opt-in.
 */
export function sessionFastMode(entries: readonly unknown[], settings: FastModeSettings, live?: LiveFastMode): boolean
{
	const liveFastMode = currentLiveFastMode(entries, live);
	if (liveFastMode !== null) return liveFastMode;
	for (let i = entries.length - 1; i >= 0; i--)
	{
		const speed = assistantSpeed(entries[i]);
		if (speed !== null) return speed === "fast";
	}
	return settings.fastMode === true && settings.fastModePerSessionOptIn !== true;
}

/** The composer-state fields a session's fast mode reads. */
export interface FastModeServerState
{
	settingsFastMode: boolean;
	fastModeBlocked: FastModeBlocked | null;
	statusline:
	{
		fast_mode?: boolean | undefined;
	} | null;
	statuslineUpdatedAt: string | null;
}

/**
 * A session chin's fast mode and block: `sessionFastMode` over the transcript, settings and live statusline, with a
 * live on (or cooldown) lifting only the managed-policy block, as upstream's `N = (me===false && !ae) || $a(M)`.
 */
export function sessionComposerFastMode(
	entries: readonly unknown[],
	server: FastModeServerState | null | undefined,
):
{
	fastMode: boolean;
	fastModeBlocked: FastModeBlocked | null;
}
{
	const live: LiveFastMode =
	{
		fastMode: server?.statusline?.fast_mode,
		updatedAt: server?.statuslineUpdatedAt ?? null,
	};
	const blocked = server?.fastModeBlocked ?? null;
	return {
		fastMode: sessionFastMode(
			entries,
			{
				fastMode: server?.settingsFastMode,
			},
			live,
		),
		fastModeBlocked: liftPolicyBlock(blocked, currentLiveFastMode(entries, live) === true),
	};
}

/** A live on (or cooldown) overrides a managed `fastMode: false`, but never the env or provider blocks. */
function liftPolicyBlock(blocked: FastModeBlocked | null, liveOn: boolean): FastModeBlocked | null
{
	return liveOn && blocked?.code === "preference" ? null : blocked;
}

/** Why the CLI can't use fast mode in a session, as the Model menu's blocked row shows it. */
export interface FastModeBlocked
{
	/** The CLI's `fast_mode_disabled_reason`. */
	code: "not_first_party" | "disabled_by_env" | "preference";
	/** The row's second line. */
	line: string;
	/** The reason tooltip; upstream shows none for some codes. */
	reason?: string | undefined;
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
	/** The live CLI reports fast mode on or in cooldown; it lifts only the managed-policy block. */
	liveOn?: boolean | undefined;
}

/** The CLI's env truthiness rule. */
export function envTruthy(value: string | undefined): boolean
{
	return value !== undefined && ["1", "true", "yes", "on"].includes(value.toLowerCase().trim());
}

const THIRD_PARTY_PROVIDER_ENV = ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"];

/**
 * The CLI's fast-mode disabled reason for a desktop-local session, mapped to upstream's row copy: a third-party
 * provider first, then `CLAUDE_CODE_DISABLE_FAST_MODE`, then a managed policy `fastMode: false` (unless `liveOn`).
 */
export function fastModeBlockedReason({env = {}, policy, liveOn = false}: FastModeBlockSources): FastModeBlocked | null
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
	if (policy?.fastMode !== false) return null;
	return liftPolicyBlock(
		{
			code: "preference",
			line: "Not available",
		},
		liveOn,
	);
}
