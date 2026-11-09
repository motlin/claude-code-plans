import {z} from "zod";

import {formatModelName} from "./model-name";
import {launchPermissionModeLabels} from "./schema-choices";

/**
 * The composer's mode / model / effort / fast / worktree choices for the next fork or launch,
 * passed to the `claude` CLI as `--permission-mode`, `--model`, `--effort`, `--settings` and `--worktree`.
 */

/** Upstream mode registry order for a local CLI session; `default` is the CLI's name for Manual. */
export const LaunchPermissionModeSchema = z.enum(["auto", "default", "acceptEdits", "plan", "bypassPermissions"]);
export type LaunchPermissionMode = z.infer<typeof LaunchPermissionModeSchema>;

export const EffortLevelSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type EffortLevel = z.infer<typeof EffortLevelSchema>;

export const EFFORT_LEVELS = EffortLevelSchema.options;

/** Same shape `validateClaudeLaunchArgs` accepts for `--model`. */
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._[\]-]*$/;
const ModelIdSchema = z.string().regex(MODEL_ID_PATTERN);

export const LaunchOptionsSchema = z.strictObject({
	permissionMode: LaunchPermissionModeSchema.optional(),
	model: ModelIdSchema.optional(),
	effort: EffortLevelSchema.optional(),
	fastMode: z.boolean().optional(),
	/**
	 * Upstream's Ultracode switch: a thinking mode that combines with any effort. The CLI arms it per session through its
	 * `ultracode` settings key (`--settings`, or `/effort ultracode on|off` live).
	 */
	ultracode: z.boolean().optional(),
	/** The CLI's `-w, --worktree [name]`: start in a new git worktree with a generated name. */
	worktree: z.literal(true).optional(),
});
export type LaunchOptions = z.infer<typeof LaunchOptionsSchema>;

/** CLI flags for the chosen options, one argv entry per word; never joined into a shell string. */
export function buildLaunchFlags({
	permissionMode,
	model,
	effort,
	fastMode,
	ultracode,
	worktree,
}: LaunchOptions): string[] {
	const flags: string[] = [];
	if (permissionMode !== undefined) flags.push("--permission-mode", permissionMode);
	if (model !== undefined) flags.push("--model", model);
	if (effort !== undefined) flags.push("--effort", effort);
	const settings = launchSettings(fastMode === true, ultracode === true);
	if (settings !== null) flags.push("--settings", settings);
	// Last, so the flag's optional name can never take the next flag's value.
	if (worktree === true) flags.push("--worktree");
	return flags;
}

/**
 * The `--settings` JSON for a fast and/or Ultracode start, or null for neither. Flag settings win over
 * `fastModePerSessionOptIn`, so the session starts fast.
 */
function launchSettings(fastMode: boolean, ultracode: boolean): string | null {
	if (!fastMode && !ultracode) return null;
	return JSON.stringify({...(fastMode ? {fastMode: true} : {}), ...(ultracode ? {ultracode: true} : {})});
}

/** Every `--settings` JSON a launch may pass: only fast mode and Ultracode, never arbitrary settings. */
export const LAUNCH_SETTINGS_VALUES: ReadonlySet<string> = new Set(
	[launchSettings(true, false), launchSettings(false, true), launchSettings(true, true)].filter(
		(value) => value !== null,
	),
);

export interface ModeMenuItem {
	id: LaunchPermissionMode;
	label: string;
	description: string;
	warning: boolean;
}

const MODE_DESCRIPTIONS = {
	auto: "Claude handles permission decisions",
	default: "Always ask before making changes",
	acceptEdits: "Automatically accept all file edits",
	plan: "Create a plan before making changes",
	bypassPermissions: "Accepts all permissions",
} satisfies Record<LaunchPermissionMode, string>;

/** Chin trigger text; upstream shortens only Bypass permissions. */
export function modeTriggerLabel(mode: LaunchPermissionMode): string {
	return mode === "bypassPermissions" ? "Bypass" : launchPermissionModeLabels[mode];
}

/** Mode menu rows for a local session: Auto · Manual · Accept edits · Plan (+ Bypass when allowed). */
export function modeMenuItems(bypassPermissionsAllowed: boolean): ModeMenuItem[] {
	return LaunchPermissionModeSchema.options
		.filter((id) => id !== "bypassPermissions" || bypassPermissionsAllowed)
		.map((id) => ({
			id,
			label: launchPermissionModeLabels[id],
			description: MODE_DESCRIPTIONS[id],
			warning: id === "bypassPermissions",
		}));
}

/**
 * Bypass permissions launches without the CLI's own warning prompt only when
 * settings already opt into it.
 */
export function isBypassPermissionsAllowed(settings: {
	defaultMode?: string | undefined;
	skipDangerousModePermissionPrompt?: boolean | undefined;
}): boolean {
	return settings.defaultMode === "bypassPermissions" || settings.skipDangerousModePermissionPrompt === true;
}

export interface ModelChoice {
	id: string;
	label: string;
}

/** The full id each family alias currently launches. */
const ALIAS_LATEST: Readonly<Record<string, string>> = {
	opus: "claude-opus-5-5",
	fable: "claude-fable-5-1",
	sonnet: "claude-sonnet-5-5",
	haiku: "claude-haiku-5-5",
};

/** The CLI's family aliases in upstream's menu order, labelled with the version each launches. */
export const PRIMARY_MODELS: readonly ModelChoice[] = Object.entries(ALIAS_LATEST).map(([id, latest]) => ({
	id,
	label: formatModelName(latest) ?? id,
}));

/** Upstream's "More models" submenu: older full ids the primary aliases no longer launch, in its order. */
export const MORE_MODELS: readonly ModelChoice[] = [
	"claude-haiku-4-5-20251001",
	"claude-sonnet-5",
	"claude-opus-5",
	"claude-fable-5",
	"claude-opus-4-8",
	"claude-opus-4-7",
	"claude-opus-4-6",
	"claude-sonnet-4-6",
].map((id) => ({id, label: formatModelName(id) ?? id}));

/** What `claude` launches when settings name no model. */
export const CLI_DEFAULT_MODEL = "claude-opus-5-5";

/** The model `claude` would launch with for a settings.json `model` value, as a full id. */
export function resolveLaunchModel(settingsModel: string | null): string {
	if (!settingsModel || settingsModel === "default") return CLI_DEFAULT_MODEL;
	return (Object.hasOwn(ALIAS_LATEST, settingsModel) ? ALIAS_LATEST[settingsModel] : undefined) ?? settingsModel;
}

/**
 * The Model menu value a session's model id selects: the full id when "More
 * models" lists it, else its family alias, else null.
 */
export function modelMenuValue(id: string | null): string | null {
	if (id === null) return null;
	const bare = id.replace(/\[[^\]]*\]$/, "");
	if (MORE_MODELS.some((model) => model.id === bare)) return bare;
	const family = bare.replace(/^claude-/, "").split("-")[0];
	return PRIMARY_MODELS.find((model) => model.id === family)?.id ?? null;
}

/** The primary row a menu value checks: an alias, or the full id an alias launches. */
export function primaryModelMenuValue(current: string | undefined): string {
	if (current === undefined) return "";
	if (Object.hasOwn(ALIAS_LATEST, current)) return current;
	return Object.entries(ALIAS_LATEST).find(([, latest]) => latest === current)?.[0] ?? "";
}

/** The "More models" row a menu value checks: an alias checks the full id it launches. */
export function moreModelsMenuValue(current: string | undefined): string {
	if (current === undefined) return "";
	return (Object.hasOwn(ALIAS_LATEST, current) ? ALIAS_LATEST[current] : undefined) ?? current;
}

/** Models whose catalog entry offers the Fast mode toggle (upstream `fast_mode:{type:"toggle"}`). */
const FAST_MODE_MODELS: ReadonlySet<string> = new Set([
	"claude-opus-5-5",
	"claude-opus-5",
	"claude-opus-4-8",
	"claude-opus-4-6",
]);

/** Whether a model id or family alias offers fast mode; a `[1m]` context suffix doesn't matter. */
export function fastModeSupported(model: string): boolean {
	return FAST_MODE_MODELS.has(resolveLaunchModel(model.replace(/\[[^\]]*\]$/, "")));
}

/** Upstream's Max row tooltip for a model whose Max carries the usage warning badge. */
export const MAX_EFFORT_TOOLTIP =
	"Claude thinks longer with Max effort and can consume 3.5× or more usage than Medium.";
/** Upstream's Max row tooltip on every other model. */
export const MAX_EFFORT_GENERIC_TOOLTIP =
	"May use excessive tokens resulting in long response times and may hit token limits. Use sparingly for the hardest tasks.";

const ALL_LEVELS: readonly EffortLevel[] = EFFORT_LEVELS;
const NO_XHIGH: readonly EffortLevel[] = ["low", "medium", "high", "max"];

/**
 * Each model's `thinking.effort_options` from the live claude.ai catalog (mirrored by the CLI's embedded
 * `surfaces.cc`): its levels in catalog order and the one badged Recommended (also the model's default effort).
 * Keyed by full id without a date suffix. Models absent here take Opus 5.5's rows without its Max warning; the
 * Haiku 4.5 family (`thinking.type: "none"`) offers no Effort section.
 */
const EFFORT_CATALOG: Readonly<Record<string, {levels: readonly EffortLevel[]; recommended: EffortLevel}>> = {
	"claude-opus-5-5": {levels: ALL_LEVELS, recommended: "medium"},
	"claude-fable-5-1": {levels: ALL_LEVELS, recommended: "high"},
	"claude-sonnet-5-5": {levels: ALL_LEVELS, recommended: "medium"},
	"claude-haiku-5-5": {levels: ALL_LEVELS, recommended: "medium"},
	"claude-sonnet-5": {levels: ALL_LEVELS, recommended: "high"},
	"claude-opus-5": {levels: ALL_LEVELS, recommended: "high"},
	"claude-fable-5": {levels: ALL_LEVELS, recommended: "high"},
	"claude-opus-4-8": {levels: ALL_LEVELS, recommended: "high"},
	"claude-opus-4-7": {levels: ALL_LEVELS, recommended: "xhigh"},
	"claude-opus-4-6": {levels: NO_XHIGH, recommended: "high"},
	"claude-sonnet-4-6": {levels: NO_XHIGH, recommended: "high"},
	"claude-haiku-4-5": {levels: [], recommended: "medium"},
};
const UNKNOWN_MODEL_EFFORT = {levels: ALL_LEVELS, recommended: "medium"} as const;

/** Only the web catalog badges Opus 5.5's Max "3.5× or more usage"; the CLI's copy gives it the generic tooltip. */
const MAX_WARNING_MODELS: ReadonlySet<string> = new Set(["claude-opus-5-5"]);

/** One Effort submenu row: upstream's catalog option with its Recommended badge, Max warning badge and tooltip. */
export interface EffortOption {
	id: EffortLevel;
	recommended: boolean;
	/** Upstream's warning badge (`badge.variant === "warning"`): the chip, trigger icon and aria suffix. */
	maxWarning: boolean;
	tooltip?: string;
}

function catalogKey(model: string): string {
	return resolveLaunchModel(model.replace(/\[[^\]]*\]$/, "")).replace(/-\d{8}$/, "");
}

function catalogEntry(model: string) {
	const key = catalogKey(model);
	return {key, entry: Object.hasOwn(EFFORT_CATALOG, key) ? EFFORT_CATALOG[key] : undefined};
}

/** The Effort submenu rows a model id or alias offers, in catalog order; empty when it has no Effort section. */
export function effortOptionsFor(model: string): EffortOption[] {
	const {key, entry} = catalogEntry(model);
	const {levels, recommended} = entry ?? UNKNOWN_MODEL_EFFORT;
	const warning = MAX_WARNING_MODELS.has(key);
	return levels.map((id) =>
		id === "max"
			? {
					id,
					recommended: false,
					maxWarning: warning,
					tooltip: warning ? MAX_EFFORT_TOOLTIP : MAX_EFFORT_GENERIC_TOOLTIP,
				}
			: {id, recommended: id === recommended, maxWarning: false},
	);
}

/** The effort levels a model id or alias offers; empty when it has no Effort section. */
export function effortLevelsFor(model: string): readonly EffortLevel[] {
	return effortOptionsFor(model).map((option) => option.id);
}

/** The effort a model runs at when nothing picked one (its Recommended level), or null when it has no effort. */
export function defaultEffortFor(model: string): EffortLevel | null {
	const {entry} = catalogEntry(model);
	const {levels, recommended} = entry ?? UNKNOWN_MODEL_EFFORT;
	return levels.length === 0 ? null : recommended;
}

/**
 * Options with a new model. Fast mode is dropped when that model lacks it, as the CLI turns it off; so is an effort
 * it doesn't offer, so the chin falls back to the session's or the model's own effort, as upstream's per-model memory.
 */
export function withModel(options: LaunchOptions, model: string): LaunchOptions {
	const {fastMode, effort, ...rest} = options;
	return {
		...rest,
		...(effort !== undefined && effortLevelsFor(model).includes(effort) ? {effort} : {}),
		...(fastMode !== undefined && fastModeSupported(model) ? {fastMode} : {}),
		model,
	};
}

export function modelLabel(id: string): string {
	if (id === "default") return modelLabel(CLI_DEFAULT_MODEL);
	return [...PRIMARY_MODELS, ...MORE_MODELS].find((model) => model.id === id)?.label ?? formatModelName(id) ?? id;
}

/** The CLI's shift+tab permission-mode cycle; modes the session lacks are skipped. */
const PERMISSION_MODE_CYCLE: readonly LaunchPermissionMode[] = [
	"default",
	"acceptEdits",
	"plan",
	"auto",
	"bypassPermissions",
];

/**
 * Shift+tab presses that step a live CLI from `current` to `target`, or null
 * when either mode is outside the session's cycle.
 */
export function shiftTabCount(
	current: string,
	target: LaunchPermissionMode,
	availableModes: readonly LaunchPermissionMode[],
): number | null {
	const cycle = PERMISSION_MODE_CYCLE.filter((mode) => availableModes.includes(mode));
	const from = cycle.findIndex((mode) => mode === current);
	const to = cycle.indexOf(target);
	if (from === -1 || to === -1) return null;
	return (to - from + cycle.length) % cycle.length;
}

/** Chin picks steer the live pane only while it is idle and accepts writes. */
export function canApplyLive({
	hasLivePane,
	writesEnabled,
	working,
}: {
	hasLivePane: boolean;
	writesEnabled: boolean;
	working: boolean;
}): boolean {
	return hasLivePane && writesEnabled && !working;
}

/** One chin pick applied to a live pane: a `/model`, `/effort`, `/effort ultracode` or `/fast` prompt, or shift+tab presses. */
export const LiveOptionChangeSchema = z.discriminatedUnion("kind", [
	z.strictObject({kind: z.literal("model"), model: ModelIdSchema}),
	z.strictObject({kind: z.literal("effort"), effort: EffortLevelSchema}),
	z.strictObject({kind: z.literal("fast"), on: z.boolean()}),
	z.strictObject({kind: z.literal("ultracode"), on: z.boolean()}),
	z.strictObject({
		kind: z.literal("mode"),
		presses: z
			.number()
			.int()
			.min(1)
			.max(PERMISSION_MODE_CYCLE.length - 1),
	}),
]);
export type LiveOptionChange = z.infer<typeof LiveOptionChangeSchema>;
