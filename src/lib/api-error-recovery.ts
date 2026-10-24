import type {ApiErrorCategory} from "./api-error-category";

/**
 * The API error card's recovery-row decision, ported from upstream's `Kt` hook
 * (c3e34355f). Pure: which actions show, which one is primary, and their order.
 */

export type RecoveryActionKey = "rewind" | "compact" | "compact-split" | "retry" | "fallback" | "switch-model";

export interface RecoveryAction {
	key: RecoveryActionKey;
	primary: boolean;
	label: string;
}

export interface RecoveryModelItem {
	value: string;
	checked: boolean;
}

export interface RecoveryInput {
	retryHelps: boolean;
	rewindHelps: boolean;
	compactHelps: boolean;
	isOverloaded: boolean;
	modelSwitchHelps: boolean;
	/** Upstream's latch: any action pressed hides the whole row. */
	retried: boolean;
	canRetry: boolean;
	canRewind: boolean;
	canCompact: boolean;
	canFallback: boolean;
	currentModelLabel: string;
	fallbackModelLabel?: string;
	modelItems?: readonly RecoveryModelItem[];
}

/** Upstream's fixed render order, before the primary is moved to the trailing edge. */
const BASE_ORDER: readonly RecoveryActionKey[] = [
	"rewind",
	"compact",
	"compact-split",
	"retry",
	"fallback",
	"switch-model",
];

/** Upstream's primary preference: compact, then rewind, then retry, then fallback. */
const PRIMARY_ORDER: readonly RecoveryActionKey[] = ["compact", "compact-split", "rewind", "retry", "fallback"];

export function recoveryActions(input: RecoveryInput): RecoveryAction[] {
	if (input.retried) return [];

	const rewind = input.rewindHelps && input.canRewind;
	const compact = input.compactHelps && input.canCompact;
	const switchModel =
		input.modelSwitchHelps &&
		!rewind &&
		input.canRetry &&
		(input.modelItems?.some((item) => !item.checked) ?? false);
	const fallbackLabel = input.fallbackModelLabel;
	// Upstream's onRetryWithFallback only exists when the session is retryable.
	const fallback =
		input.isOverloaded &&
		!rewind &&
		!switchModel &&
		input.canRetry &&
		input.canFallback &&
		fallbackLabel !== undefined;
	const retry = input.canRetry && input.retryHelps && !fallback;

	const shown = new Map<RecoveryActionKey, string>();
	// With compact shown, rewind folds into the compact split button's menu.
	if (rewind && !compact) shown.set("rewind", "Rewind");
	if (compact) shown.set(rewind ? "compact-split" : "compact", "Compact session");
	if (retry) shown.set("retry", "Try again");
	if (fallback) shown.set("fallback", `Try again with ${fallbackLabel}`);
	if (switchModel) shown.set("switch-model", input.currentModelLabel);

	const primaryKey = PRIMARY_ORDER.find((key) => shown.has(key));
	const actions = BASE_ORDER.flatMap((key): RecoveryAction[] => {
		const label = shown.get(key);
		return label === undefined ? [] : [{key, primary: key === primaryKey, label}];
	});
	return [...actions.filter((action) => !action.primary), ...actions.filter((action) => action.primary)];
}

export interface FallbackModel {
	alias: "sonnet" | "haiku";
	label: "Sonnet" | "Haiku";
}

/** Upstream's `Aq`/`jq`: the next-smaller model to retry an overloaded turn with. */
export function fallbackModel(runningModel: string): FallbackModel | undefined {
	if (runningModel.startsWith("claude-opus")) return {alias: "sonnet", label: "Sonnet"};
	if (runningModel.startsWith("claude-sonnet")) return {alias: "haiku", label: "Haiku"};
	return undefined;
}

export interface CategoryRecoveryHelps {
	retryHelps: boolean;
	compactHelps: boolean;
	isOverloaded: boolean;
	modelSwitchHelps: boolean;
}

/** Upstream's `wr` rows with `retryHelps: true`; `unknown` depends on its HTTP status. */
const RETRY_HELPS: ReadonlySet<ApiErrorCategory> = new Set([
	"rate_limit",
	"server_rate_limit",
	"overloaded",
	"server_error",
	"stream_idle_timeout",
	"network",
	"model_not_found",
	"output_token_limit",
]);

/**
 * Upstream's `at(status)` isn't in the dumped chunk; this is the Anthropic SDK's retry rule
 * (408, 409, 429 and every 5xx), which the same statuses in `wr` already follow.
 */
function retryableStatus(status: number | undefined): boolean {
	if (status === undefined) return false;
	return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** The per-category flags upstream's card `HW` feeds the recovery row. */
export function categoryRecoveryHelps(category: ApiErrorCategory, status?: number): CategoryRecoveryHelps {
	return {
		retryHelps: RETRY_HELPS.has(category) || (category === "unknown" && retryableStatus(status)),
		compactHelps: category === "context_length",
		isOverloaded: category === "overloaded",
		modelSwitchHelps: category === "overloaded" || category === "model_not_found",
	};
}
