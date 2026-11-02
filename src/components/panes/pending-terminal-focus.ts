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
