/**
 * Upstream's global "marked" flag (c05f93f78 export `i`, read by the ⌘/ dialog as `e => e.marked`):
 * set the first time any terminal records a command from its shell's OSC 133 prompt marks, and
 * never cleared, so the dialog lists the terminal command-scroll keys from then on.
 */

import {useSyncExternalStore} from "react";

let marked = false;
const listeners = new Set<() => void>();

export function markTerminalCommand(): void
{
	if (marked) return;
	marked = true;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

export function useTerminalCommandsMarked(): boolean
{
	return useSyncExternalStore(
		subscribe,
		() => marked,
		() => false,
	);
}

/** Clear the flag, as a reload would. */
export function resetTerminalCommandsMarked(): void
{
	if (!marked) return;
	marked = false;
	for (const listener of listeners) listener();
}
