/**
 * Upstream's `overflowMenuOpen`: a menu opened from a trigger inside the peek is open, or the session
 * list's whitespace context menu is (`data-overflow-menu-open`).
 */
export function isPeekMenuOpen(peek: HTMLElement | null): boolean
{
	return peek?.querySelector('[aria-haspopup][aria-expanded="true"], [data-overflow-menu-open]') != null;
}
