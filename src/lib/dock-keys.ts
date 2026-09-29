/**
 * True when a bare key (digit, Esc) should act on a docked card: nothing else is being
 * typed into, apart from the composer while it is still empty.
 */
export function dockKeyAllowed(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return false;
  const editable =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable;
  if (!editable) return true;
  return (
    target instanceof HTMLTextAreaElement &&
    target.value === "" &&
    target.closest('[data-focus-region="composer"]') !== null
  );
}
