import {z} from "zod";
import {type Statusline, StatuslineSchema} from "./api/statusline";
import {defaultEffortFor, resolveLaunchModel} from "./launch-options";
import {formatModelName, SYNTHETIC_MODEL} from "./model-name";
import type {AvailableModels} from "./model-restrictions";
import {formatWeeklyReset, type UsageSummary} from "./usage";
import {type ScopedMeter, scopedEmptyCaption, visibleScopedMeters} from "./usage-family";
import {nonEmpty} from "./non-empty";
import type {FastModeBlocked} from "./session-fast-mode";

/**
 * The composer chin's readouts (mode · model · effort · usage ring), resolved
 * from local state the way claude.ai/code shows them for a session.
 */

export const MODE_LABELS: Record<string, string> =
{
	auto: "Auto",
	default: "Manual",
	acceptEdits: "Accept edits",
	plan: "Plan",
	bypassPermissions: "Bypass permissions",
	dontAsk: "Don't ask",
};

export const EFFORT_LABELS: Record<string, string> =
{
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra-high",
	max: "Max",
};

/** For a model with no effort of its own (Haiku 4.5), whose chin hides the effort word anyway. */
const NO_EFFORT_FALLBACK = "high";

/** 2πr for the upstream ring's r=6 circle, rounded exactly as upstream writes it. */
export const USAGE_RING_CIRCUMFERENCE = 37.699;

export interface ComposerStateSources
{
	/** `permission_mode` from the latest hook event; `""` means the turn context was cleared. */
	hookPermissionMode: string | null | undefined;
	jsonlPermissionMode: string | null;
	settingsDefaultMode: string | null;
	/** The statusline's `model.display_name`. */
	statuslineModel: string | null;
	/** The statusline's `model.id`. */
	statuslineModelId: string | null;
	/** Raw `message.model` of the newest assistant record. */
	lastAssistantModel: string | null;
	/** Context usage of the newest assistant record; the fallback when there is no statusline. */
	lastAssistantUsage: TranscriptContextUsage | null;
	/** The effort the newest assistant turn ran at; claude.ai/code shows it for a session. */
	lastAssistantEffort: string | null;
	/** settings.json `model`: what a session with no model yet launches with. */
	settingsModel: string | null;
	/** `settingsModel` comes from managed (policy) settings: upstream's "Set by admin". */
	settingsModelManaged: boolean;
	settingsAvailableModels: AvailableModels | null;
	settingsEffortLevel: string | null;
	/** `sessionFastMode` over the transcript, settings.json and the live statusline. */
	fastMode: boolean;
	/** Why the CLI can't use fast mode in this session (`ComposerServerState.fastModeBlocked`). */
	fastModeBlocked: FastModeBlocked | null;
	statusline: Statusline | null;
	statuslineUpdatedAt: string | null;
}

export interface TranscriptContextUsage
{
	contextTokens: number;
	/** The assistant record's `timestamp`. */
	timestamp: string | null;
}

export interface ComposerLabelled
{
	id: string;
	label: string;
}

export interface RateLimitWindow
{
	usedPercentage: number;
	/** Epoch seconds. */
	resetsAt: number;
}

export interface ComposerUsage
{
	contextTokens: number | null;
	contextWindowSize: number | null;
	contextPercent: number | null;
	/** Set when `contextWindowSize` is the model-table guess (transcript fallback), not the statusline's own window. */
	estimatedWindow?: true;
	fiveHour: RateLimitWindow | null;
	weekly: RateLimitWindow | null;
	updatedAt: string | null;
	/** The account's cached per-model rows for the current model's family (`withAccountLimits`). */
	scoped?: ScopedMeter[];
}

export interface ComposerState
{
	mode: ComposerLabelled | null;
	/** Trigger text, e.g. "Opus 5.5". */
	model: string;
	/** The id behind `model`; the Model menu checks its row. */
	modelId: string;
	/** The model settings.json launches with; a session pick that differs gets upstream's overridden cue. */
	settingsModelId: string;
	/** The model settings name, badged "Default" ("Set by admin" when managed) in the Model menu; null when unset. */
	settingsDefault:
	{
		id: string;
		managed: boolean;
	} | null;
	/** Settings `availableModels`: Model menu rows it leaves out are disabled. */
	availableModels: AvailableModels | null;
	effort: ComposerLabelled;
	/** The trigger's " Fast" word and the chin's "Fast mode on|off" live status; always off while blocked. */
	fastMode: boolean;
	/** Upstream's blocked Fast mode row: greyed, with this second line and reason tooltip. */
	fastModeBlocked: FastModeBlocked | null;
	usage: ComposerUsage | null;
}

function toWindow(
	window:
		|
		  {
				used_percentage: number;
				resets_at: number;
		  }
		| undefined,
): RateLimitWindow | null
{
	return window
		?
			{
				usedPercentage: window.used_percentage,
				resetsAt: window.resets_at,
			}
		: null;
}

function resolveUsage(statusline: Statusline, updatedAt: string | null): ComposerUsage
{
	const context = statusline.context_window;
	const size = context?.context_window_size ?? null;
	const percent = context?.used_percentage ?? null;
	const current = context?.current_usage;
	let tokens: number | null = null;
	if (current)
	{
		tokens = current.input_tokens + current.cache_creation_input_tokens + current.cache_read_input_tokens;
	}
	else if (size !== null && percent !== null)
	{
		tokens = Math.round((size * percent) / 100);
	}
	return {
		contextTokens: tokens,
		contextWindowSize: size,
		contextPercent: percent,
		fiveHour: toWindow(statusline.rate_limits?.five_hour),
		weekly: toWindow(statusline.rate_limits?.seven_day),
		updatedAt,
	};
}

const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Context window by model id, matching what Claude Code's statusline reports for each. */
const CONTEXT_WINDOWS: ReadonlyArray<readonly [RegExp, number]> = [
	[/\[1m\]$/i, 1_000_000],
	[/^claude-(opus|sonnet|fable)-5(-|$)/, 1_000_000],
];

function contextWindowSizeForModel(modelId: string): number
{
	return CONTEXT_WINDOWS.find(([pattern]) => pattern.test(modelId))?.[1] ?? DEFAULT_CONTEXT_WINDOW;
}

function resolveTranscriptUsage(usage: TranscriptContextUsage, modelId: string): ComposerUsage
{
	const size = contextWindowSizeForModel(modelId);
	return {
		contextTokens: usage.contextTokens,
		contextWindowSize: size,
		contextPercent: (usage.contextTokens / size) * 100,
		estimatedWindow: true,
		fiveHour: null,
		weekly: null,
		updatedAt: usage.timestamp,
	};
}

function resolveComposerUsage(sources: ComposerStateSources, modelId: string): ComposerUsage | null
{
	if (sources.statusline) return resolveUsage(sources.statusline, sources.statuslineUpdatedAt);
	if (sources.lastAssistantUsage) return resolveTranscriptUsage(sources.lastAssistantUsage, modelId);
	return null;
}

/**
 * mode = hook ?? JSONL ?? settings; model = statusline ?? last assistant ?? settings ?? the CLI default;
 * effort = last assistant ?? settings ?? the model's default (its catalog Recommended); usage = statusline ?? the last assistant record's usage.
 */
export function resolveComposerState(sources: ComposerStateSources): ComposerState
{
	const modeId =
		nonEmpty(sources.hookPermissionMode) ??
		nonEmpty(sources.jsonlPermissionMode) ??
		nonEmpty(sources.settingsDefaultMode) ??
		null;
	const modelId =
		nonEmpty(sources.statuslineModelId) ??
		nonEmpty(sources.lastAssistantModel) ??
		resolveLaunchModel(sources.settingsModel);
	const effortId =
		nonEmpty(sources.lastAssistantEffort) ??
		nonEmpty(sources.settingsEffortLevel) ??
		defaultEffortFor(modelId) ??
		NO_EFFORT_FALLBACK;
	return {
		mode:
			modeId === null
				? null
				:
					{
						id: modeId,
						label: MODE_LABELS[modeId] ?? modeId,
					},
		model: nonEmpty(sources.statuslineModel) ?? formatModelName(modelId) ?? modelId,
		modelId,
		settingsModelId: resolveLaunchModel(sources.settingsModel),
		settingsDefault:
			nonEmpty(sources.settingsModel) === undefined
				? null
				:
					{
						id: resolveLaunchModel(sources.settingsModel),
						managed: sources.settingsModelManaged,
					},
		availableModels: sources.settingsAvailableModels,
		effort:
		{
			id: effortId,
			label: EFFORT_LABELS[effortId] ?? effortId,
		},
		fastMode: sources.fastModeBlocked === null && sources.fastMode,
		fastModeBlocked: sources.fastModeBlocked,
		usage: resolveComposerUsage(sources, modelId),
	};
}

type RecordLike = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is RecordLike
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Newest `permissionMode` on a `permission-mode` or `user` JSONL record. */
export function lastPermissionModeFromRecords(records: readonly unknown[]): string | null
{
	for (let i = records.length - 1; i >= 0; i--)
	{
		const record = records[i];
		if (!isRecord(record)) continue;
		if (record["type"] !== "permission-mode" && record["type"] !== "user") continue;
		const mode = record["permissionMode"];
		if (typeof mode === "string" && mode !== "") return mode;
	}
	return null;
}

/** Newest assistant `message.model` that names a real model. */
export function lastAssistantModelFromRecords(records: readonly unknown[]): string | null
{
	for (let i = records.length - 1; i >= 0; i--)
	{
		const record = records[i];
		if (!isRecord(record) || record["type"] !== "assistant") continue;
		const message = record["message"];
		if (!isRecord(message)) continue;
		const model = message["model"];
		if (typeof model === "string" && model !== "" && model !== SYNTHETIC_MODEL) return model;
	}
	return null;
}

/** Newest real assistant record's `perTurnEffort`, else the session `effort` it ran under. */
export function lastAssistantEffortFromRecords(records: readonly unknown[]): string | null
{
	for (let i = records.length - 1; i >= 0; i--)
	{
		const record = records[i];
		if (!isRecord(record) || record["type"] !== "assistant") continue;
		const message = record["message"];
		if (!isRecord(message) || message["model"] === SYNTHETIC_MODEL) continue;
		const effort = record["perTurnEffort"] ?? record["effort"];
		if (typeof effort === "string" && effort !== "") return effort;
	}
	return null;
}

function tokenCount(usage: RecordLike, key: string): number
{
	const value = usage[key];
	return typeof value === "number" ? value : 0;
}

/** The context an assistant turn consumed: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. */
function contextTokensFromUsage(usage: unknown): number | null
{
	if (!isRecord(usage)) return null;
	return (
		tokenCount(usage, "input_tokens") +
		tokenCount(usage, "cache_read_input_tokens") +
		tokenCount(usage, "cache_creation_input_tokens")
	);
}

/** Context usage of the newest real assistant record that carries `message.usage`. */
export function lastAssistantUsageFromRecords(records: readonly unknown[]): TranscriptContextUsage | null
{
	for (let i = records.length - 1; i >= 0; i--)
	{
		const record = records[i];
		if (!isRecord(record) || record["type"] !== "assistant") continue;
		const message = record["message"];
		if (!isRecord(message) || message["model"] === SYNTHETIC_MODEL) continue;
		const contextTokens = contextTokensFromUsage(message["usage"]);
		if (contextTokens === null) continue;
		const timestamp = record["timestamp"];
		return {
			contextTokens,
			timestamp: typeof timestamp === "string" ? timestamp : null,
		};
	}
	return null;
}

export function usageRingDashoffset(percent: number | null): number
{
	const clamped = Math.min(100, Math.max(0, percent ?? 0));
	return (1 - clamped / 100) * USAGE_RING_CIRCUMFERENCE;
}

function trimDecimal(value: number): string
{
	return String(Math.round(value * 10) / 10);
}

/** `190200` → `190.2k`, `1000000` → `1M`, as upstream prints token counts. */
export function formatTokenCount(count: number): string
{
	if (count >= 1_000_000) return `${trimDecimal(count / 1_000_000)}M`;
	// Upstream `vj` promotes a value that rounds up to 1000k ("1M", not "1000k").
	if (count >= 1_000) return Math.round(count / 100) >= 10_000 ? "1M" : `${trimDecimal(count / 1_000)}k`;
	return String(count);
}

/**
 * Upstream's reset copy: a countdown inside the next day ("Resets in 14 hr 31 min"),
 * otherwise the weekday and time of the reset ("Resets Tue 4:00 AM").
 */
export function formatResetLabel(resetsAtSec: number, nowMs: number, timeZone?: string): string
{
	const totalMinutes = Math.max(0, Math.floor((resetsAtSec * 1000 - nowMs) / 60_000));
	if (totalMinutes >= 1440) return formatWeeklyReset(resetsAtSec, timeZone);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours === 0) return `Resets in ${minutes} min`;
	return minutes > 0 ? `Resets in ${hours} hr ${minutes} min` : `Resets in ${hours} hr`;
}

/** `190.2k / 1M (19%)`, or `0` when the statusline has no context usage yet. */
export function formatContextSummary(usage: ComposerUsage | null): string
{
	if (!usage || usage.contextTokens === null || usage.contextWindowSize === null) return "0";
	return `${formatTokenCount(usage.contextTokens)} / ${formatTokenCount(usage.contextWindowSize)}`;
}

/**
 * Fills the ring's plan limits from the account usage (`/api/usage`) when the statusline reported none, as on the home
 * bar (no statusline) or a session whose statusline lacks `rate_limits`. Context usage stays the session's own.
 */
export function withComposerAccountLimits(state: ComposerState, summary: UsageSummary | undefined): ComposerState
{
	const usage = withAccountLimits(state.usage, summary, state.modelId);
	return usage === state.usage
		? state
		:
			{
				...state,
				usage,
			};
}

/**
 * The usage half of `withComposerAccountLimits`, plus the account's cached per-model rows that
 * apply to `modelId`'s family (upstream's ring and popover filter).
 */
export function withAccountLimits(
	usage: ComposerUsage | null,
	summary: UsageSummary | undefined,
	modelId?: string | null,
): ComposerUsage | null
{
	const withWindows = withAccountWindows(usage, summary);
	const scoped = visibleScopedMeters(summary?.scoped, modelId);
	if (scoped.length === 0) return withWindows;
	return {
		...(withWindows ??
		{
			contextTokens: null,
			contextWindowSize: null,
			contextPercent: null,
			fiveHour: null,
			weekly: null,
			updatedAt: summary?.updatedAt ?? null,
		}),
		scoped,
	};
}

function withAccountWindows(usage: ComposerUsage | null, summary: UsageSummary | undefined): ComposerUsage | null
{
	if (summary === undefined || (summary.fiveHour === null && summary.sevenDay === null)) return usage;
	if (usage !== null && (usage.fiveHour !== null || usage.weekly !== null)) return usage;
	const toLimit = (window: UsageSummary["fiveHour"]): RateLimitWindow | null =>
		window === null
			? null
			:
				{
					usedPercentage: window.usedPct,
					resetsAt: window.resetsAt,
				};
	return {
		contextTokens: usage?.contextTokens ?? null,
		contextWindowSize: usage?.contextWindowSize ?? null,
		contextPercent: usage?.contextPercent ?? null,
		...(usage?.estimatedWindow === true
			?
				{
					estimatedWindow: true,
				}
			: {}),
		fiveHour: toLimit(summary.fiveHour),
		weekly: toLimit(summary.sevenDay),
		updatedAt: usage?.updatedAt ?? summary.updatedAt,
	};
}

export const FIVE_HOUR_LABEL = "Session limit";
export const WEEKLY_LABEL = "Weekly · all models";

interface UsageLimits
{
	fiveHour?: Pick<RateLimitWindow, "usedPercentage"> | null;
	weekly?: Pick<RateLimitWindow, "usedPercentage"> | null;
	scoped?: readonly Pick<ScopedMeter, "usedPercentage">[] | undefined;
}

interface RingLimit
{
	label: string;
	usedPercentage: number;
	/** Epoch seconds, or null before the window has started. */
	resetsAt: number | null;
	/** The reset caption while `resetsAt` is null. */
	emptyCaption: string;
}

/**
 * The one limit the ring summarises: the most used one, weekly on a tie with the session, as
 * upstream does; a per-model row speaks only when it is strictly higher.
 */
function topLimit(usage: ComposerUsage | null): RingLimit | null
{
	const {weekly, fiveHour, scoped = []} = usage ?? {};
	const windowLimit = (label: string, window: RateLimitWindow): RingLimit => (
	{
		label,
		usedPercentage: window.usedPercentage,
		resetsAt: window.resetsAt,
		emptyCaption: "Starts with your first message",
	});
	let top: RingLimit | null = null;
	if (weekly && (!fiveHour || weekly.usedPercentage >= fiveHour.usedPercentage))
	{
		top = windowLimit(WEEKLY_LABEL, weekly);
	}
	else if (fiveHour)
	{
		top = windowLimit(FIVE_HOUR_LABEL, fiveHour);
	}
	for (const meter of scoped)
	{
		if (top === null || meter.usedPercentage > top.usedPercentage)
		{
			top =
			{
				label: meter.label,
				usedPercentage: meter.usedPercentage,
				resetsAt: meter.resetsAt,
				emptyCaption: scopedEmptyCaption(meter),
			};
		}
	}
	return top;
}

function limitReset(limit: RingLimit, nowMs: number, timeZone: string | undefined): string
{
	return limit.resetsAt === null ? limit.emptyCaption : formatResetLabel(limit.resetsAt, nowMs, timeZone);
}

/** The ring's fill: the highest plan-limit utilisation, or null with no limits. */
export function usageRingPercent(usage: UsageLimits | null): number | null
{
	const percents = [usage?.fiveHour, usage?.weekly, ...(usage?.scoped ?? [])].flatMap((window) =>
		window ? [window.usedPercentage] : [],
	);
	return percents.length > 0 ? Math.max(...percents) : null;
}

export type UsageRingSeverity = "normal" | "warning" | "critical";

/** Upstream's arc colour thresholds: ≥75 warning, ≥90 danger. */
export function usageRingSeverity(percent: number | null): UsageRingSeverity
{
	if (percent === null || percent < 75) return "normal";
	return percent >= 90 ? "critical" : "warning";
}

/** Upstream's ring host `Pr`: plan limits when it has window rows, else the context window (`Kn` → none). */
export type UsageRingMode = "plan" | "context";

export function usageRingMode(usage: ComposerUsage | null): UsageRingMode
{
	if (usage?.fiveHour || usage?.weekly || (usage?.scoped?.length ?? 0) > 0) return "plan";
	return usage?.contextTokens == null ? "plan" : "context";
}

/** Upstream `ru`'s percent: the rounded, clamped share of the window, or null with no window or past it. */
function contextPct(tokens: number, max: number | null): number | null
{
	if (max === null || tokens > max) return null;
	return Math.round(Math.min(1, Math.max(0, tokens / max)) * 100);
}

/** Upstream `ru(tokens, max, exact, withPct)`: "656.2k / 1M (66%)", or just the tokens with no window or past it. */
export function formatContextRingSummary(tokens: number, max: number | null): string
{
	const pct = contextPct(tokens, max);
	if (max === null || pct === null) return formatTokenCount(tokens);
	return `${formatTokenCount(tokens)} / ${formatTokenCount(max)} (${pct}%)`;
}

/** The context-mode ring's percent, or null without context tokens or a window that holds them. */
export function contextRingPercent(usage: ComposerUsage | null): number | null
{
	if (usage?.contextTokens == null) return null;
	return contextPct(usage.contextTokens, usage.contextWindowSize);
}

/** The context-mode ring's summary, or null when there are no context tokens. */
function contextRingSummary(usage: ComposerUsage | null): string | null
{
	if (usageRingMode(usage) !== "context" || usage?.contextTokens == null) return null;
	return formatContextRingSummary(usage.contextTokens, usage.contextWindowSize);
}

/**
 * "Usage: Weekly · all models: 73%, Resets Tue 4:00 AM", "Usage: Context 656.2k / 1M (66%)" in context mode,
 * or "Usage" with neither.
 */
export function formatUsageAriaLabel(usage: ComposerUsage | null, nowMs: number, timeZone?: string): string
{
	const context = contextRingSummary(usage);
	if (context !== null) return `Usage: Context ${context}`;
	const limit = topLimit(usage);
	if (!limit) return "Usage";
	return `Usage: ${limit.label}: ${Math.round(limit.usedPercentage)}%, ${limitReset(limit, nowMs, timeZone)}`;
}

/** The ring tooltip's rows: "Weekly · all models: 73%", then "Resets Tue 4:00 AM"; in context mode "Context …". */
export function formatUsageTooltipRows(usage: ComposerUsage | null, nowMs: number, timeZone?: string): string[]
{
	const context = contextRingSummary(usage);
	if (context !== null) return [`Context ${context}`];
	const limit = topLimit(usage);
	if (!limit) return ["Usage"];
	return [`${limit.label}: ${Math.round(limit.usedPercentage)}%`, limitReset(limit, nowMs, timeZone)];
}

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
	["day", 86_400],
	["hour", 3_600],
	["minute", 60],
];

/** "3 hours ago", "1 minute ago", "just now". */
export function formatUpdatedAgo(iso: string, nowMs: number): string
{
	const seconds = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000));
	const format = new Intl.RelativeTimeFormat(
		"en",
		{
			numeric: "always",
		},
	);
	for (const [unit, size] of RELATIVE_UNITS)
	{
		if (seconds >= size) return format.format(-Math.floor(seconds / size), unit);
	}
	return "just now";
}

const FastModeBlockedResponse: z.ZodType<FastModeBlocked> = z.strictObject(
	{
		code: z.enum(["not_first_party", "disabled_by_env", "preference"]),
		line: z.string(),
		reason: z.string().optional(),
	},
);

const AvailableModelsSchema: z.ZodType<AvailableModels> = z.strictObject(
	{
		value: z.array(z.string()),
		source: z.string(),
		path: z.string(),
	},
);

/** The server-side half of the chin: settings defaults plus the statusline snapshot. */
export interface ComposerServerState
{
	/** `permissions.defaultMode`, managed settings beating the user's. */
	settingsDefaultMode: string | null;
	/** `settingsDefaultMode` comes from managed (policy) settings. */
	settingsDefaultModeManaged: boolean;
	settingsModel: string | null;
	/** `settingsModel` comes from managed (policy) settings. */
	settingsModelManaged: boolean;
	/** Settings `availableModels` with its source (managed beats user), or null when unset. */
	settingsAvailableModels: AvailableModels | null;
	settingsEffortLevel: string | null;
	/** Settings let a launch use Bypass permissions (see `isBypassPermissionsAllowed`). */
	settingsBypassPermissionsAllowed: boolean;
	/** Settings start a fresh session in fast mode (`sessionFastMode` with no turns). */
	settingsFastMode: boolean;
	/** settings.json `advisorModel`: the session's advisor before its first turn, or null when unset. */
	settingsAdvisorModel: string | null;
	/** Why the CLI can't use fast mode here (`fastModeBlockedReason`), or null. */
	fastModeBlocked: FastModeBlocked | null;
	statusline: Statusline | null;
	statuslineUpdatedAt: string | null;
}

export const ComposerServerStateResponse: z.ZodType<ComposerServerState> = z.strictObject(
	{
		settingsDefaultMode: z.string().nullable(),
		settingsDefaultModeManaged: z.boolean(),
		settingsModel: z.string().nullable(),
		settingsModelManaged: z.boolean(),
		settingsAvailableModels: AvailableModelsSchema.nullable(),
		settingsEffortLevel: z.string().nullable(),
		settingsBypassPermissionsAllowed: z.boolean(),
		settingsFastMode: z.boolean(),
		settingsAdvisorModel: z.string().nullable(),
		fastModeBlocked: FastModeBlockedResponse.nullable(),
		statusline: StatuslineSchema.nullable(),
		statuslineUpdatedAt: z.string().nullable(),
	},
);

/** The CLI's own no-flag start mode: Auto by its rollout fallback, or Manual (`default`). */
export type CliFallbackMode = "auto" | "default";

/** Launch defaults from `~/.claude/settings.json` for the home composer chin. */
export interface ComposerDefaults
{
	model: string | null;
	/** `model` comes from managed (policy) settings. */
	modelManaged: boolean;
	availableModels: AvailableModels | null;
	effortLevel: string | null;
	/** `permissions.defaultMode`, managed settings beating the user's. */
	defaultMode: string | null;
	/** `defaultMode` comes from managed (policy) settings. */
	defaultModeManaged: boolean;
	/** The `?cwd=` project folder's `permissions.defaultMode` (settings.local.json over settings.json), or null. */
	repoDefaultMode: string | null;
	bypassPermissionsAllowed: boolean;
	/** A fresh session starts in fast mode (`sessionFastMode` with no turns). */
	fastMode: boolean;
	/** Why the CLI can't use fast mode in a new session, or null. */
	fastModeBlocked: FastModeBlocked | null;
	/** The mode the CLI starts in when no `--permission-mode` and no settings layer gives one (CLI `wCn`). */
	cliFallbackMode: CliFallbackMode;
}

export const ComposerDefaultsResponse: z.ZodType<ComposerDefaults> = z.strictObject(
	{
		model: z.string().nullable(),
		modelManaged: z.boolean(),
		availableModels: AvailableModelsSchema.nullable(),
		effortLevel: z.string().nullable(),
		defaultMode: z.string().nullable(),
		defaultModeManaged: z.boolean(),
		repoDefaultMode: z.string().nullable(),
		bypassPermissionsAllowed: z.boolean(),
		fastMode: z.boolean(),
		fastModeBlocked: FastModeBlockedResponse.nullable(),
		cliFallbackMode: z.enum(["auto", "default"]),
	},
);
