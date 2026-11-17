import {useLayoutEffect, useState} from "react";

import {useReducedMotion} from "./reduced-motion";
import type {PlanTodo} from "./session-plan-model";

/** Upstream `HF = parseFloat(--cds-dur-base)`: how long a dropped plan keeps rendering while it exits. */
export const PLAN_EXIT_HOLD_MS = 200;

/**
 * Upstream `WF`: while working, remember the box's todos; when the box drops, keep rendering them with
 * `closing` for the exit's duration. Reduced motion, or a box that drops from the non-working state, has no hold.
 */
export function usePlanExitHold(
	todos: PlanTodo[] | null,
	working: boolean,
):
{
	todos: PlanTodo[] | null;
	closing: boolean;
}
{
	const reduceMotion = useReducedMotion();
	const [held, setHeld] = useState<PlanTodo[] | null>(null);
	const next = todos === null && !reduceMotion ? held : working ? todos : null;
	if (held !== next) setHeld(next);
	const closing = todos === null && next !== null;
	useLayoutEffect(() =>
	{
		if (!closing) return undefined;
		const timer = setTimeout(() =>
		{
			setHeld(null);
		}, PLAN_EXIT_HOLD_MS);
		return () =>
		{
			clearTimeout(timer);
		};
	}, [closing]);
	return {
		todos: todos ?? next,
		closing,
	};
}
