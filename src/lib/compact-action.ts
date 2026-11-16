import {formatTokenCount} from "./composer-state";

/** Upstream `Ja`'s result: the context card's Compact session row is hidden, disabled with a reason, or enabled. */
export type CompactActionState =
	|
	  {
			kind: "hidden";
	  }
	|
	  {
			kind: "disabled";
			reason: "replying" | "reconnect";
	  }
	|
	  {
			kind: "enabled";
	  };

/** Upstream `Ya`: whether the session can take a typed `/compact` now (`live`), once reconnected, or not at all. */
export type CompactReach = "live" | "detached" | "dormant";

export interface CompactActionGate
{
	/** The window's used percent, null when there is no usage. */
	contextPct: number | null;
	/** Upstream `minPct`. */
	minPct?: number;
	hasHandler: boolean;
	reach: CompactReach;
	/** A turn is running or a send is in flight. */
	responding: boolean;
	compacting: boolean;
}

export const COMPACT_DISABLED_REASON =
{
	replying: "Available when Claude finishes this turn",
	reconnect: "Available when reconnected",
} as const satisfies Record<
	Extract<
		CompactActionState,
		{
			kind: "disabled";
		}
	>["reason"],
	string
>;

/** Upstream `oo` → `qa` → `Ja`, without the stale-session absolute floor (no local analogue). */
export function compactActionState({
	contextPct,
	minPct = 50,
	hasHandler,
	reach,
	responding,
	compacting,
}: CompactActionGate): CompactActionState
{
	if (contextPct === null || contextPct < minPct || !hasHandler || reach === "dormant" || compacting)
	{
		return {
			kind: "hidden",
		};
	}
	if (reach === "detached")
	{
		return {
			kind: "disabled",
			reason: "reconnect",
		};
	}
	if (responding)
	{
		return {
			kind: "disabled",
			reason: "replying",
		};
	}
	return {
		kind: "enabled",
	};
}

export interface AutoCompactWindow
{
	rawMaxTokens: number;
	autoCompactThreshold: number | null;
	isAutoCompactEnabled: boolean;
	autocompactBufferTokens: number | null;
}

/** Upstream `Xa`: the token count auto-compact fires at, or null when it is off or unknown. */
export function autoCompactThreshold(window: AutoCompactWindow): number | null
{
	if (!(window.rawMaxTokens > 0) || !window.isAutoCompactEnabled) return null;
	const explicit = window.autoCompactThreshold;
	if (explicit !== null && explicit > 0 && explicit < window.rawMaxTokens) return explicit;
	const buffer = window.autocompactBufferTokens ?? 0;
	return !(buffer > 0) || buffer >= window.rawMaxTokens ? null : window.rawMaxTokens - buffer;
}

/** Upstream `Za`: under this many tokens left the hint says "Auto-compacts soon". */
const SOON_TOKENS = 30_000;

/** Upstream `Qa`: floors to two significant digits. */
function floorTwoSignificant(value: number): number
{
	const whole = Math.floor(value);
	const step = 10 ** (String(whole).length - 2);
	return Math.floor(whole / step) * step;
}

/** Upstream `$a` → `eo`: the hint beside Compact session, or null for none. */
export function autoCompactHint(threshold: number | null, used: number | null): string | null
{
	if (threshold === null || used === null) return null;
	const left = threshold - used;
	if (!Number.isFinite(left)) return null;
	if (left < SOON_TOKENS) return "Auto-compacts soon";
	return `${formatTokenCount(floorTwoSignificant(left))} until auto-compact`;
}
