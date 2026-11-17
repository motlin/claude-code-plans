import {useEffect} from "react";

import
{
	clearJumpHints,
	isJumpChord,
	isJumpGatedFocus,
	JUMP_DIGITS,
	JUMP_HOLD_MS,
	JUMP_MODIFIER_KEYS,
	jumpHintsShown,
	jumpKeyOf,
	jumpOverlayOwnsFocus,
	jumpRowKeyFor,
	jumpScope,
	showJumpHints,
} from "../../lib/sidebar-jump-hints";

/** Upstream `XA`: a row's main button, if the row is still shown. */
function rowMainButton(rowKey: string): HTMLElement | null
{
	const row = jumpScope()?.querySelector<HTMLElement>(`[data-jump-hint-row][data-row-key="${CSS.escape(rowKey)}"]`);
	if (row === null || row === undefined || row.offsetParent === null) return null;
	return row.querySelector<HTMLElement>("[data-row-main-button]");
}

/** Upstream `H$`/`QZ`: bring the row into view and open it. */
function jumpTo(rowKey: string): void
{
	const button = rowMainButton(rowKey);
	if (button === null) return;
	button.scrollIntoView(
		{
			block: "nearest",
		},
	);
	button.click();
}

/**
 * Upstream `HQ`, web only: hold Ctrl+Shift for 200ms to number the first nine visible session rows, and
 * Ctrl+Shift+1…9 opens one, shown or not. `enabled` is false while the sidebar is collapsed or peeked,
 * where every keydown hides the keycaps instead.
 */
export function useSidebarJumpHints(enabled: boolean): void
{
	useEffect(() =>
	{
		let timer: ReturnType<typeof setTimeout> | null = null;

		function cancel(): void
		{
			if (timer === null) return;
			clearTimeout(timer);
			timer = null;
		}

		function hide(): void
		{
			cancel();
			clearJumpHints();
		}

		function arm(): void
		{
			if (jumpHintsShown() || timer !== null) return;
			timer = setTimeout(() =>
			{
				timer = null;
				if (isJumpGatedFocus(document.activeElement) || jumpOverlayOwnsFocus()) return;
				showJumpHints(jumpScope());
			}, JUMP_HOLD_MS);
		}

		function onKeyDown(event: KeyboardEvent): void
		{
			if (!enabled || !isJumpChord(event))
			{
				hide();
				return;
			}
			if (isJumpGatedFocus(document.activeElement))
			{
				cancel();
				return;
			}
			const modifier = JUMP_MODIFIER_KEYS.has(event.key);
			if (!modifier) cancel();
			if (event.defaultPrevented || event.repeat) return;
			if (modifier)
			{
				arm();
				return;
			}
			const pressed = jumpKeyOf(event);
			if (pressed === null) return;
			if (!JUMP_DIGITS.includes(pressed))
			{
				hide();
				return;
			}
			if (jumpOverlayOwnsFocus())
			{
				clearJumpHints();
				return;
			}
			if (!jumpHintsShown()) showJumpHints(jumpScope());
			const rowKey = jumpRowKeyFor(pressed);
			if (rowKey === null)
			{
				clearJumpHints();
				return;
			}
			event.preventDefault();
			jumpTo(rowKey);
			clearJumpHints();
		}

		function onKeyUp(event: KeyboardEvent): void
		{
			if (isJumpChord(event)) arm();
			else hide();
		}

		function onPointer(event: MouseEvent | WheelEvent): void
		{
			if (!jumpHintsShown() && timer === null) return;
			if (!isJumpChord(event)) hide();
		}

		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", hide);
		window.addEventListener("mousemove", onPointer);
		window.addEventListener("mousedown", onPointer);
		window.addEventListener(
			"wheel",
			onPointer,
			{
				passive: true,
			},
		);
		document.addEventListener("visibilitychange", hide);
		return () =>
		{
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", hide);
			window.removeEventListener("mousemove", onPointer);
			window.removeEventListener("mousedown", onPointer);
			window.removeEventListener("wheel", onPointer);
			document.removeEventListener("visibilitychange", hide);
			hide();
		};
	}, [enabled]);
}
