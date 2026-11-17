/**
 * Upstream's `shell.tailActionsOutlet`: the `transcript-tail-actions` element below the turn box, which the turn-tail
 * row's message actions portal into.
 */
export interface TailActionsOutlet
{
	set: (element: HTMLElement | null) => void;
	get: () => HTMLElement | null;
	subscribe: (listener: () => void) => () => void;
}

export function createTailActionsOutlet(): TailActionsOutlet
{
	let current: HTMLElement | null = null;
	const listeners = new Set<() => void>();
	return {
		set(element)
		{
			if (element === current) return;
			current = element;
			for (const listener of listeners) listener();
		},
		get: () => current,
		subscribe(listener)
		{
			listeners.add(listener);
			return () =>
			{
				listeners.delete(listener);
			};
		},
	};
}
