import {contextWindowSizeForModel} from "./composer-state";
import type {ContextBreakdown} from "./context-breakdown";
import {baseModelId} from "./model-name";
import type {ContextWindowSource} from "./schemas";

/** Upstream `Mh`: the first engine (CLI) version that knows each model's 1M window. */
const MIN_ENGINE_FOR_1M: ReadonlyMap<string, string> = new Map([["claude-opus-5", "2.1.219"]]);

/** Upstream `Nh`: the window an engine that misreports a model falls back to. */
const FALLBACK_WINDOW = 200_000;
/** Upstream `Ph`. */
const ONE_MILLION = 1_000_000;

export interface StaleEngineInputs
{
	rawMaxTokens: number;
	autocompactSource: ContextWindowSource | undefined;
	model: string | undefined;
	/** The CLI version running the session. */
	engineVersion: string | null;
	/** The model catalog says the model has a 1M window. */
	catalogSupports1m: boolean;
	/** The window the session's model was launched with, when known. */
	launchedModelWindow: number | null;
	surfaceAutoCompactWindow: number | null;
}

/** `enforced`: the session really runs at `max` (200k). Otherwise the engine only misreports, and `max` is the real window. */
export interface StaleEngine
{
	max: number;
	enforced: boolean;
}

/** Upstream `Md`: compares dotted numeric versions part by part. */
function compareVersions(a: string, b: string): number
{
	const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
	for (let i = 0; i < Math.max(left.length, right.length); i++)
	{
		const diff = (left[i] ?? 0) - (right[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

/** Upstream `Ih` (exported as `Ya`): whether an out-of-date engine limits or misreports this session's window. */
export function detectStaleEngine(inputs: StaleEngineInputs): StaleEngine | null
{
	if (inputs.rawMaxTokens !== FALLBACK_WINDOW) return null;
	if (inputs.autocompactSource === "unknown-model")
	{
		return (inputs.launchedModelWindow ?? 0) > inputs.rawMaxTokens
			?
				{
					max: inputs.rawMaxTokens,
					enforced: true,
				}
			: null;
	}
	const min = inputs.model === undefined ? undefined : MIN_ENGINE_FOR_1M.get(baseModelId(inputs.model));
	if (
		inputs.autocompactSource !== "auto" ||
		inputs.engineVersion === null ||
		min === undefined ||
		compareVersions(inputs.engineVersion, min) >= 0
	)
		return null;
	return inputs.catalogSupports1m
		?
			{
				max: Math.min(ONE_MILLION, inputs.surfaceAutoCompactWindow ?? ONE_MILLION),
				enforced: false,
			}
		: null;
}

/** The stale-engine verdict for a breakdown, with the local model table standing in for upstream's catalog. */
export function staleEngineForBreakdown(breakdown: ContextBreakdown, engineVersion: string | null): StaleEngine | null
{
	const window = breakdown.model === undefined ? null : contextWindowSizeForModel(breakdown.model);
	return detectStaleEngine(
		{
			rawMaxTokens: breakdown.rawMaxTokens,
			autocompactSource: breakdown.autocompactSource,
			model: breakdown.model,
			engineVersion,
			catalogSupports1m: window !== null && window >= ONE_MILLION,
			launchedModelWindow: window,
			surfaceAutoCompactWindow: null,
		},
	);
}

/** Upstream `st`: the breakdown measured against `max`, with Free space taking up the difference. */
export function rescaleBreakdown(breakdown: ContextBreakdown, max: number): ContextBreakdown
{
	const grown = max - breakdown.rawMaxTokens;
	return {
		...breakdown,
		categories: breakdown.categories.map((category) =>
			category.kind === "free"
				?
					{
						...category,
						tokens: Math.max(0, category.tokens + grown),
					}
				: category,
		),
		rawMaxTokens: max,
		percentage: max > 0 ? (breakdown.totalTokens / max) * 100 : breakdown.percentage,
	};
}

/** The verdict and the breakdown to draw: a misreported window is rescaled to the real one (upstream `gr`). */
export function resolveStaleEngine(
	breakdown: ContextBreakdown,
	engineVersion: string | null,
):
{
	staleEngine: StaleEngine | null;
	breakdown: ContextBreakdown;
}
{
	const staleEngine = staleEngineForBreakdown(breakdown, engineVersion);
	return {
		staleEngine,
		breakdown:
			staleEngine !== null && !staleEngine.enforced ? rescaleBreakdown(breakdown, staleEngine.max) : breakdown,
	};
}

/** The newest transcript record's CLI `version`, or null when none carries one. */
export function latestRecordVersion(records: readonly unknown[]): string | null
{
	for (let i = records.length - 1; i >= 0; i--)
	{
		const record = records[i];
		if (typeof record !== "object" || record === null || !("version" in record)) continue;
		if (typeof record.version === "string") return record.version;
	}
	return null;
}
