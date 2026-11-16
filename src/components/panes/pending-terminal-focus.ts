/** Set by ⌃` when it opens the pane, consumed on mount so the new pane takes focus. */
let pendingTerminalFocus = false;

/** Whether ⌃` just opened the Terminal pane; clears the request so only the pane it opened takes focus. */
export function consumePendingTerminalFocus(): boolean
{
	const pending = pendingTerminalFocus;
	pendingTerminalFocus = false;
	return pending;
}

/** Asks the Terminal pane that mounts next to take focus. */
export function requestTerminalFocus(): void
{
	pendingTerminalFocus = true;
}

/** Set by ⌃⇧` from outside the pane, consumed by the Terminal pane that is open or mounts next. */
let pendingNewTerminal = false;
const newTerminalListeners = new Set<() => void>();

/** Asks the Terminal pane to start a Shell tab and focus it, now if it is open, else once it mounts. */
export function requestNewTerminal(): void
{
	pendingNewTerminal = true;
	for (const listener of newTerminalListeners) listener();
}

/** Whether a new Shell tab was asked for; clears the request so only one pane answers it. */
export function consumePendingNewTerminal(): boolean
{
	const pending = pendingNewTerminal;
	pendingNewTerminal = false;
	return pending;
}

export function subscribeNewTerminal(listener: () => void): () => void
{
	newTerminalListeners.add(listener);
	return () => newTerminalListeners.delete(listener);
}
