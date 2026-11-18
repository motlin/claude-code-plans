import type {ScopedUsage} from "./usage";

/**
 * The composer usage ring and popover show only the cached usage rows that apply to the current
 * model, as upstream's `Dr`/`Lm`/`W6`/`Gn` do: a Fable-only weekly limit is hidden under Opus.
 */

const MODEL_FAMILIES = ["sonnet", "opus", "haiku", "fable", "mythos"] as const;

export interface ModelFamily
{
	family: string | undefined;
	/** A recognised model without a family: every model-scoped row is hidden. */
	excludeModelScoped: boolean;
}

function isModelFamily(value: string | undefined): value is (typeof MODEL_FAMILIES)[number]
{
	return (MODEL_FAMILIES as readonly (string | undefined)[]).includes(value);
}

/** Upstream's `Dr`: "claude-opus-5-5" → opus, "claude-3-5-sonnet-20241022" → sonnet, "opus[1m]" → opus. */
export function modelFamily(modelId: string | null | undefined): ModelFamily
{
	if (!modelId)
		return {
			family: undefined,
			excludeModelScoped: false,
		};
	const id = modelId.toLowerCase();
	const first = id.replace(/^claude-/, "").split(/[-.@[\]]/)[0];
	if (isModelFamily(first))
		return {
			family: first,
			excludeModelScoped: false,
		};
	const parsed = /^claude-([a-z]+)-\d+/.exec(id) ?? /^claude-\d{1,2}(?:-\d{1,2})?-(opus|sonnet|haiku)/.exec(id);
	return {
		family: parsed?.[1],
		excludeModelScoped: false,
	};
}

/** One cached usage row beyond the session and week windows the statusline already reports. */
export interface ScopedMeter
{
	key: string;
	kind: string;
	/** Upstream's `Zg`: "Weekly · Fable", the bare scope, or "Usage". */
	label: string;
	usedPercentage: number;
	/** Epoch seconds, or null before the window has started. */
	resetsAt: number | null;
	modelScope: string | undefined;
	surfaceScope: string | undefined;
}

/** Upstream's `Lm`/`gp`: no family, no model scope, or a scope naming the family. No mythos alias. */
export function matchesFamily(meter: Pick<ScopedMeter, "modelScope">, family: string | undefined): boolean
{
	if (!family || !meter.modelScope) return true;
	const scope = meter.modelScope.trim().toLowerCase();
	return scope === "" || scope.includes(family);
}

/** The session and week rows come from the fresher statusline windows. */
const STATUSLINE_KINDS = new Set(["session", "weekly_all"]);

/**
 * The cached rows the ring and popover show for `modelId`: model-scoped rows of its family,
 * never surface-scoped rows (upstream's `u` filter, then `Lm`).
 */
export function visibleScopedMeters(
	scoped: ScopedUsage | null | undefined,
	modelId: string | null | undefined,
): ScopedMeter[]
{
	if (!scoped) return [];
	const {family, excludeModelScoped} = modelFamily(modelId);
	return scoped.limits.flatMap((limit, index): ScopedMeter[] =>
	{
		if (STATUSLINE_KINDS.has(limit.kind)) return [];
		const modelScope = limit.scope?.model?.display_name;
		const surfaceScope = limit.scope?.surface?.display_name;
		const scope = modelScope ?? surfaceScope;
		const meter: ScopedMeter =
		{
			key: `${limit.kind}-${index}`,
			kind: limit.kind,
			label: scope ? (limit.group === "weekly" ? `Weekly · ${scope}` : scope) : "Usage",
			usedPercentage: limit.percent,
			resetsAt: limit.resets_at === null ? null : Date.parse(limit.resets_at) / 1000,
			modelScope,
			surfaceScope,
		};
		const shown = surfaceScope === undefined && !(excludeModelScoped && modelScope) && matchesFamily(meter, family);
		return shown ? [meter] : [];
	});
}

/** Upstream's `Kn`: the caption of a row whose window has not started. */
export function scopedEmptyCaption(meter: Pick<ScopedMeter, "modelScope">): string
{
	return meter.modelScope ? `You haven’t used ${meter.modelScope} yet` : "Starts with your first message";
}
