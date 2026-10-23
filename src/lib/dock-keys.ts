/**
 * True when a bare key (digit, Esc) should act on a docked card: nothing else is being
 * typed into, apart from the composer while it is still empty.
 */
export function dockKeyAllowed(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return true;
	if (target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return false;
	const editable =
		target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
	if (!editable) return true;
	return (
		target instanceof HTMLTextAreaElement &&
		target.value === "" &&
		target.closest('[data-focus-region="composer"]') !== null
	);
}

/** Upstream's approval arm grace: an approval key this soon after the card mounts is swallowed. */
export const APPROVAL_ARM_GRACE_MS = 400;

/** The session composer's textarea, with no slash or mention popup open. */
export function isIdleComposer(element: Element | null): element is HTMLTextAreaElement {
	return (
		element instanceof HTMLTextAreaElement &&
		element.closest("[data-composer-card]") !== null &&
		!element.hasAttribute("aria-controls")
	);
}

/** Whether focus is where upstream's approval hotkey listens: the card, the page body, or the session composer with no popup open. */
export function approvalHotkeyFocusAllowed(card: HTMLElement): boolean {
	const active = document.activeElement;
	return active === null || active === document.body || card.contains(active) || isIdleComposer(active);
}

/** Whether any of the card is inside the viewport; upstream's approval keys yield while it is scrolled away. */
export function onScreen(card: HTMLElement): boolean {
	const rect = card.getBoundingClientRect();
	return rect.bottom >= 0 && rect.top <= window.innerHeight;
}
