import {createContext, type RefObject, useCallback, useRef, useState} from "react";
import {flushSync} from "react-dom";

/** Upstream's 2px hysteresis: a collapsed bar stays collapsed until it grows this far past the width it needed. */
const HYSTERESIS_PX = 2;

/** Overflow up to this is rounding, not a real overflow. */
const OVERFLOW_TOLERANCE_PX = 0.5;

/**
 * Whether the environment bar's place chips show only their icons. Upstream wraps only the chips group in it; the
 * pickers never read it.
 */
export const EnvironmentBarIconOnlyContext = createContext(false);

interface Saved
{
	need: number;
	signature: string;
}

export interface EnvironmentBarIconOnly
{
	iconOnly: boolean;
	rowRef: (el: HTMLDivElement | null) => (() => void) | undefined;
	chipsRef: RefObject<HTMLDivElement | null>;
	pickersRef: RefObject<HTMLDivElement | null>;
	modeRef: RefObject<HTMLDivElement | null>;
}

/**
 * The bar's layout identity: the chip labels stay in the DOM as `sr-only` text while collapsed, so this holds
 * steady then, and picking another folder, model or mode changes it.
 */
function signature(chips: HTMLElement, pickers: HTMLElement, mode: HTMLElement | null, wrapped: boolean): string
{
	return [
		chips.textContent,
		pickers.textContent,
		mode === null ? 0 : Math.round(mode.getBoundingClientRect().width),
		wrapped,
	].join("|");
}

/**
 * Upstream's environment-bar collapse hook: collapse the place chips to their icons once the pickers (or, when the
 * row has wrapped, the chips line) overflow the row's content box, and expand again only when the row grows past
 * the width it needed plus 2px or the bar's text changes. Each measure runs up to two passes, committing with
 * `flushSync`, so an expand that overflows again re-collapses in the same frame.
 */
export function useEnvironmentBarIconOnly(): EnvironmentBarIconOnly
{
	const [iconOnly, setIconOnly] = useState(false);
	const chipsRef = useRef<HTMLDivElement | null>(null);
	const pickersRef = useRef<HTMLDivElement | null>(null);
	const modeRef = useRef<HTMLDivElement | null>(null);
	const collapsedRef = useRef(false);
	const savedRef = useRef<Saved | undefined>(undefined);

	const rowRef = useCallback((rowEl: HTMLDivElement | null) =>
	{
		if (rowEl === null) return undefined;
		const measure = () =>
		{
			for (let pass = 0; pass < 2; pass++)
			{
				const chips = chipsRef.current;
				const pickers = pickersRef.current;
				if (chips === null || pickers === null) return;
				const row = rowEl.getBoundingClientRect();
				if (row.width === 0) return;
				const wrapped = pickers.offsetTop >= chips.offsetTop + chips.offsetHeight;
				let next: boolean;
				if (collapsedRef.current)
				{
					const saved = savedRef.current;
					if (
						saved !== undefined &&
						row.width < saved.need + HYSTERESIS_PX &&
						saved.signature === signature(chips, pickers, modeRef.current, wrapped)
					)
					{
						return;
					}
					next = false;
				}
				else
				{
					const target = (wrapped ? chips : pickers).getBoundingClientRect();
					const style = getComputedStyle(rowEl);
					const padStart = Number.parseFloat(style.paddingLeft) || 0;
					const padEnd = Number.parseFloat(style.paddingRight) || 0;
					const overflow = Math.max(target.right - (row.right - padEnd), row.left + padStart - target.left);
					if (overflow <= OVERFLOW_TOLERANCE_PX) return;
					savedRef.current =
					{
						need: row.width + overflow,
						signature: signature(chips, pickers, modeRef.current, wrapped),
					};
					next = true;
				}
				collapsedRef.current = next;
				flushSync(() =>
				{
					setIconOnly(next);
				});
			}
		};
		const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
		resizeObserver?.observe(rowEl);
		if (modeRef.current !== null) resizeObserver?.observe(modeRef.current);
		const mutationObserver = new MutationObserver(measure);
		mutationObserver.observe(
			rowEl,
			{
				subtree: true,
				childList: true,
				characterData: true,
			},
		);
		return () =>
		{
			resizeObserver?.disconnect();
			mutationObserver.disconnect();
		};
	}, []);

	return {
		iconOnly,
		rowRef,
		chipsRef,
		pickersRef,
		modeRef,
	};
}
