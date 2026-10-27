import {z} from "zod";
import {type Statusline, StatuslineSchema} from "./api/statusline";
import {resolveLaunchModel} from "./launch-options";
import {formatModelName, SYNTHETIC_MODEL} from "./model-name";
import {formatWeeklyReset} from "./usage";
import {nonEmpty} from "./non-empty";

/**
 * The composer chin's readouts (mode · model · effort · usage ring), resolved
 * from local state the way claude.ai/code shows them for a session.
 */

const MODE_LABELS: Record<string, string> = {
	auto: "Auto",
	default: "Manual",
	acceptEdits: "Accept edits",
	plan: "Plan",
	bypassPermissions: "Bypass permissions",
	dontAsk: "Don't ask",
};

const EFFORT_LABELS: Record<string, string> = {
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra-high",
	max: "Max",
};

const DEFAULT_EFFORT = "high";

/** 2πr for the upstream ring's r=6 circle, rounded exactly as upstream writes it. */
export const USAGE_RING_CIRCUMFERENCE = 37.699;

export interface ComposerStateSources {
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
	settingsEffortLevel: string | null;
	/** `sessionFastMode` over the transcript and settings.json. */
	fastMode: boolean;
	statusline: Statusline | null;
	statuslineUpdatedAt: string | null;
}

export interface TranscriptContextUsage {
	contextTokens: number;
	/** The assistant record's `timestamp`. */
	timestamp: string | null;
}

export interface ComposerLabelled {
	id: string;
	label: string;
}

export interface RateLimitWindow {
	usedPercentage: number;
	/** Epoch seconds. */
	resetsAt: number;
}

export interface ComposerUsage {
	contextTokens: number | null;
	contextWindowSize: number | null;
	contextPercent: number | null;
	fiveHour: RateLimitWindow | null;
	weekly: RateLimitWindow | null;
	updatedAt: string | null;
}

export interface ComposerState {
	mode: ComposerLabelled | null;
	/** Trigger text, e.g. "Opus 5.5". */
	model: string;
	/** The id behind `model`; the Model menu checks its row. */
	modelId: string;
	effort: ComposerLabelled;
	/** The trigger's " Fast" word and the chin's "Fast mode on|off" live status. */
	fastMode: boolean;
	usage: ComposerUsage | null;
}

function toWindow(window: {used_percentage: number; resets_at: number} | undefined): RateLimitWindow | null {
	return window ? {usedPercentage: window.used_percentage, resetsAt: window.resets_at} : null;
}

function resolveUsage(statusline: Statusline, updatedAt: string | null): ComposerUsage {
	const context = statusline.context_window;
	const size = context?.context_window_size ?? null;
	const percent = context?.used_percentage ?? null;
	const current = context?.current_usage;
	let tokens: number | null = null;
	if (current) {
		tokens = current.input_tokens + current.cache_creation_input_tokens + current.cache_read_input_tokens;
	} else if (size !== null && percent !== null) {
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

function contextWindowSizeForModel(modelId: string): number {
	return CONTEXT_WINDOWS.find(([pattern]) => pattern.test(modelId))?.[1] ?? DEFAULT_CONTEXT_WINDOW;
}

function resolveTranscriptUsage(usage: TranscriptContextUsage, modelId: string): ComposerUsage {
	const size = contextWindowSizeForModel(modelId);
	return {
		contextTokens: usage.contextTokens,
		contextWindowSize: size,
		contextPercent: (usage.contextTokens / size) * 100,
		fiveHour: null,
		weekly: null,
		updatedAt: usage.timestamp,
	};
}

function resolveComposerUsage(sources: ComposerStateSources, modelId: string): ComposerUsage | null {
	if (sources.statusline) return resolveUsage(sources.statusline, sources.statuslineUpdatedAt);
	if (sources.lastAssistantUsage) return resolveTranscriptUsage(sources.lastAssistantUsage, modelId);
	return null;
}

/**
 * mode = hook ?? JSONL ?? settings; model = statusline ?? last assistant ?? settings ?? the CLI default;
 * effort = last assistant ?? settings ?? "high"; usage = statusline ?? the last assistant record's usage.
 */
export function resolveComposerState(sources: ComposerStateSources): ComposerState {
	const modeId =
		nonEmpty(sources.hookPermissionMode) ??
		nonEmpty(sources.jsonlPermissionMode) ??
		nonEmpty(sources.settingsDefaultMode) ??
		null;
	const effortId = nonEmpty(sources.lastAssistantEffort) ?? nonEmpty(sources.settingsEffortLevel) ?? DEFAULT_EFFORT;
	const modelId =
		nonEmpty(sources.statuslineModelId) ??
		nonEmpty(sources.lastAssistantModel) ??
		resolveLaunchModel(sources.settingsModel);
	return {
		mode: modeId === null ? null : {id: modeId, label: MODE_LABELS[modeId] ?? modeId},
		model: nonEmpty(sources.statuslineModel) ?? formatModelName(modelId) ?? modelId,
		modelId,
		effort: {id: effortId, label: EFFORT_LABELS[effortId] ?? effortId},
		fastMode: sources.fastMode,
		usage: resolveComposerUsage(sources, modelId),
	};
}

type RecordLike = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is RecordLike {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Newest `permissionMode` on a `permission-mode` or `user` JSONL record. */
export function lastPermissionModeFromRecords(records: readonly unknown[]): string | null {
	for (let i = records.length - 1; i >= 0; i--) {
		const record = records[i];
		if (!isRecord(record)) continue;
		if (record["type"] !== "permission-mode" && record["type"] !== "user") continue;
		const mode = record["permissionMode"];
		if (typeof mode === "string" && mode !== "") return mode;
	}
	return null;
}

/** Newest assistant `message.model` that names a real model. */
export function lastAssistantModelFromRecords(records: readonly unknown[]): string | null {
	for (let i = records.length - 1; i >= 0; i--) {
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
export function lastAssistantEffortFromRecords(records: readonly unknown[]): string | null {
	for (let i = records.length - 1; i >= 0; i--) {
		const record = records[i];
		if (!isRecord(record) || record["type"] !== "assistant") continue;
		const message = record["message"];
		if (!isRecord(message) || message["model"] === SYNTHETIC_MODEL) continue;
		const effort = record["perTurnEffort"] ?? record["effort"];
		if (typeof effort === "string" && effort !== "") return effort;
	}
	return null;
}

function tokenCount(usage: RecordLike, key: string): number {
	const value = usage[key];
	return typeof value === "number" ? value : 0;
}

/** The context an assistant turn consumed: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. */
function contextTokensFromUsage(usage: unknown): number | null {
	if (!isRecord(usage)) return null;
	return (
		tokenCount(usage, "input_tokens") +
		tokenCount(usage, "cache_read_input_tokens") +
		tokenCount(usage, "cache_creation_input_tokens")
	);
}

/** Context usage of the newest real assistant record that carries `message.usage`. */
export function lastAssistantUsageFromRecords(records: readonly unknown[]): TranscriptContextUsage | null {
	for (let i = records.length - 1; i >= 0; i--) {
		const record = records[i];
		if (!isRecord(record) || record["type"] !== "assistant") continue;
		const message = record["message"];
		if (!isRecord(message) || message["model"] === SYNTHETIC_MODEL) continue;
		const contextTokens = contextTokensFromUsage(message["usage"]);
		if (contextTokens === null) continue;
		const timestamp = record["timestamp"];
		return {contextTokens, timestamp: typeof timestamp === "string" ? timestamp : null};
	}
	return null;
}

export function usageRingDashoffset(percent: number | null): number {
	const clamped = Math.min(100, Math.max(0, percent ?? 0));
	return (1 - clamped / 100) * USAGE_RING_CIRCUMFERENCE;
}

function trimDecimal(value: number): string {
	return String(Math.round(value * 10) / 10);
}

/** `190200` → `190.2k`, `1000000` → `1M`, as upstream prints token counts. */
export function formatTokenCount(count: number): string {
	if (count >= 1_000_000) return `${trimDecimal(count / 1_000_000)}M`;
	if (count >= 1_000) return `${trimDecimal(count / 1_000)}k`;
	return String(count);
}

/**
 * Upstream's reset copy: a countdown inside the next day ("Resets in 14 hr 31 min"),
 * otherwise the weekday and time of the reset ("Resets Tue 4:00 AM").
 */
export function formatResetLabel(resetsAtSec: number, nowMs: number, timeZone?: string): string {
	const totalMinutes = Math.max(0, Math.floor((resetsAtSec * 1000 - nowMs) / 60_000));
	if (totalMinutes >= 1440) return formatWeeklyReset(resetsAtSec, timeZone);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours === 0) return `Resets in ${minutes} min`;
	return minutes > 0 ? `Resets in ${hours} hr ${minutes} min` : `Resets in ${hours} hr`;
}

/** `190.2k / 1M (19%)`, or `0` when the statusline has no context usage yet. */
export function formatContextSummary(usage: ComposerUsage | null): string {
	if (!usage || usage.contextTokens === null || usage.contextWindowSize === null) return "0";
	return `${formatTokenCount(usage.contextTokens)} / ${formatTokenCount(usage.contextWindowSize)}`;
}

export const FIVE_HOUR_LABEL = "Session limit";
export const WEEKLY_LABEL = "Weekly · all models";

interface UsageLimits {
	fiveHour?: Pick<RateLimitWindow, "usedPercentage"> | null;
	weekly?: Pick<RateLimitWindow, "usedPercentage"> | null;
}

/** The one limit the ring summarises: the most used one, weekly on a tie, as upstream does. */
function topLimit(usage: ComposerUsage | null): {label: string; window: RateLimitWindow} | null {
	const {weekly, fiveHour} = usage ?? {};
	if (weekly && (!fiveHour || weekly.usedPercentage >= fiveHour.usedPercentage)) {
		return {label: WEEKLY_LABEL, window: weekly};
	}
	if (fiveHour) return {label: FIVE_HOUR_LABEL, window: fiveHour};
	return null;
}

/** The ring's fill: the highest plan-limit utilisation, or null with no limits. */
export function usageRingPercent(usage: UsageLimits | null): number | null {
	const percents = [usage?.fiveHour, usage?.weekly].flatMap((window) => (window ? [window.usedPercentage] : []));
	return percents.length > 0 ? Math.max(...percents) : null;
}

export type UsageRingSeverity = "normal" | "warning" | "critical";

/** Upstream's arc colour thresholds: ≥75 warning, ≥90 danger. */
export function usageRingSeverity(percent: number | null): UsageRingSeverity {
	if (percent === null || percent < 75) return "normal";
	return percent >= 90 ? "critical" : "warning";
}

/** "Usage: Weekly · all models: 73%, Resets Tue 4:00 AM", or "Usage" with no limits. */
export function formatUsageAriaLabel(usage: ComposerUsage | null, nowMs: number, timeZone?: string): string {
	const limit = topLimit(usage);
	if (!limit) return "Usage";
	return `Usage: ${limit.label}: ${Math.round(limit.window.usedPercentage)}%, ${formatResetLabel(limit.window.resetsAt, nowMs, timeZone)}`;
}

/** The ring tooltip's rows: "Weekly · all models: 73%", then "Resets Tue 4:00 AM". */
export function formatUsageTooltipRows(usage: ComposerUsage | null, nowMs: number, timeZone?: string): string[] {
	const limit = topLimit(usage);
	if (!limit) return ["Usage"];
	return [
		`${limit.label}: ${Math.round(limit.window.usedPercentage)}%`,
		formatResetLabel(limit.window.resetsAt, nowMs, timeZone),
	];
}

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
	["day", 86_400],
	["hour", 3_600],
	["minute", 60],
];

/** "3 hours ago", "1 minute ago", "just now". */
export function formatUpdatedAgo(iso: string, nowMs: number): string {
	const seconds = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000));
	const format = new Intl.RelativeTimeFormat("en", {numeric: "always"});
	for (const [unit, size] of RELATIVE_UNITS) {
		if (seconds >= size) return format.format(-Math.floor(seconds / size), unit);
	}
	return "just now";
}

/** The server-side half of the chin: settings defaults plus the statusline snapshot. */
export interface ComposerServerState {
	settingsDefaultMode: string | null;
	settingsModel: string | null;
	settingsEffortLevel: string | null;
	/** Settings let a launch use Bypass permissions (see `isBypassPermissionsAllowed`). */
	settingsBypassPermissionsAllowed: boolean;
	/** Settings start a fresh session in fast mode (`sessionFastMode` with no turns). */
	settingsFastMode: boolean;
	statusline: Statusline | null;
	statuslineUpdatedAt: string | null;
}

export const ComposerServerStateResponse: z.ZodType<ComposerServerState> = z.strictObject({
	settingsDefaultMode: z.string().nullable(),
	settingsModel: z.string().nullable(),
	settingsEffortLevel: z.string().nullable(),
	settingsBypassPermissionsAllowed: z.boolean(),
	settingsFastMode: z.boolean(),
	statusline: StatuslineSchema.nullable(),
	statuslineUpdatedAt: z.string().nullable(),
});

/** Launch defaults from `~/.claude/settings.json` for the home composer chin. */
export interface ComposerDefaults {
	model: string | null;
	effortLevel: string | null;
	defaultMode: string | null;
	bypassPermissionsAllowed: boolean;
	/** A fresh session starts in fast mode (`sessionFastMode` with no turns). */
	fastMode: boolean;
}

export const ComposerDefaultsResponse: z.ZodType<ComposerDefaults> = z.strictObject({
	model: z.string().nullable(),
	effortLevel: z.string().nullable(),
	defaultMode: z.string().nullable(),
	bypassPermissionsAllowed: z.boolean(),
	fastMode: z.boolean(),
});
