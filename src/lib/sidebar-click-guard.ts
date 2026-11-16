/*
 * Upstream's `ZC`/`zu` (shared-120): after a control folds rows away under the pointer, the second
 * click of a double-click must not land on whatever row slid into its place. A caret click arms the
 * guard; the session list's capture handlers swallow any multi-click (`detail > 1`) until it lapses.
 */
let guardedUntil = 0;

/** Swallow the list's multi-clicks for the next `ms` milliseconds. */
export function guardDoubleClicks(ms: number): void
{
	guardedUntil = performance.now() + ms;
}

/** The session list's capture handler: drops a multi-click while the guard is armed. */
export function swallowGuardedClick(event: {detail: number; preventDefault(): void; stopPropagation(): void}): void
{
	if (performance.now() < guardedUntil && event.detail > 1)
	{
		event.preventDefault();
		event.stopPropagation();
	}
}
