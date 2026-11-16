/*
 * Upstream's click guards (shared-120). After a control folds or reveals rows under the pointer, the
 * rest of a double-click must not land on whatever row slid into its place.
 *
 * - `WI`/`wX`: a family stub's mouse click swallows every non-keyboard click, press and
 *   double-click on the list for the next 500ms.
 * - `ZC`/`zu`: a fold caret's click swallows only multi-clicks (`detail > 1`) until it lapses.
 */
let rowsGuardedUntil = 0;
let doubleClicksGuardedUntil = 0;

/** Swallow every mouse click on the list's rows for the next `ms` milliseconds (upstream `WI`). */
export function guardRowClicks(ms: number): void
{
	rowsGuardedUntil = performance.now() + ms;
}

/** Swallow the list's multi-clicks for the next `ms` milliseconds (upstream `ZC`). */
export function guardDoubleClicks(ms: number): void
{
	doubleClicksGuardedUntil = performance.now() + ms;
}

/** The session list's capture handler (upstream `wX`): drops the clicks an armed guard covers. */
export function swallowGuardedClick(event: {
	type: string;
	detail: number;
	preventDefault(): void;
	stopPropagation(): void;
}): void
{
	const now = performance.now();
	const swallow =
		now < rowsGuardedUntil
			? event.type !== "click" || event.detail !== 0
			: now < doubleClicksGuardedUntil && event.detail > 1;
	if (swallow)
	{
		event.preventDefault();
		event.stopPropagation();
	}
}

/** Disarm both guards, so a test's fake clock starts clear of an earlier test's guard. */
export function resetClickGuards(): void
{
	rowsGuardedUntil = 0;
	doubleClicksGuardedUntil = 0;
}
