import {useSyncExternalStore} from "react";

/**
 * Upstream `pF.rowKey` (`Sy`): a row just moved, pinned or put back that must come into view. Whichever
 * sidebar section holds it reveals through it, then clears the request; `focus` also moves focus to it.
 */
interface RevealRowRequest
{
	id: string;
	focus: boolean;
}

let current: RevealRowRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void
{
	for (const listener of listeners) listener();
}

export function requestRevealRow(
	id: string,
	{
		focus = false,
	}:
	{
		focus?: boolean;
	} = {},
): void
{
	current =
	{
		id,
		focus,
	};
	emit();
}

/** Clears the request once a section shows the row; a later request for another row stays. */
export function clearRevealRow(id: string): void
{
	if (current?.id !== id) return;
	current = null;
	emit();
}

function subscribe(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

const getSnapshot = (): RevealRowRequest | null => current;

export function useRevealRow(): RevealRowRequest | null
{
	return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
