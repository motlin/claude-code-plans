import {useEffect, useState} from "react";

/** Upstream `NP`: how long a list that dropped to empty keeps showing its last nonempty value. */
const HOLD_NONZERO_MS = 3000;

/**
 * Upstream `MP`: true for the first `ms` that `active` holds. The timer fires once
 * per mount and never resets, so a later activation reads false at once; an
 * activation that ends before the timer fires restarts it next time.
 */
export function useFirstWindow(active: boolean, ms: number): boolean
{
	const [fired, setFired] = useState(false);
	useEffect(() =>
	{
		if (!active || fired) return undefined;
		const timer = setTimeout(() =>
		{
			setFired(true);
		}, ms);
		return () =>
		{
			clearTimeout(timer);
		};
	}, [active, fired, ms]);
	return active && !fired;
}

/**
 * Upstream `PP`: while enabled, remembers the last `value` whose `size` was nonzero,
 * and returns it instead of an empty one for the first 3s the size is zero. A null size
 * (still loading) counts as nonzero, as upstream's `count !== 0`.
 */
export function useHoldNonzero<T>(value: T, size: number | null, enabled: boolean): T
{
	const [held, setHeld] = useState<
	{
		value: T;
	} | null>(null);
	if (enabled && size !== 0 && held?.value !== value)
		setHeld(
			{
				value,
			},
		);
	// Upstream's `(held) ?? value`: a held loading (null) value falls through to the current one.
	return (useFirstWindow(size === 0, HOLD_NONZERO_MS) ? held?.value : undefined) ?? value;
}
