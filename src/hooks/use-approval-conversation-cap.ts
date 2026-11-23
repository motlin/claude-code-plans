import {type RefObject, useLayoutEffect} from "react";

import
{
	APPROVAL_BODY_SELECTOR,
	APPROVAL_CAP_VAR,
	APPROVAL_RECLAIM_VAR,
	createConversationCapFitter,
} from "../lib/approval-conversation-cap";
import {maybe, nearestScroller, windowOf} from "../lib/read-gate";

/** Upstream `R`: animation frames to wait for the card's scroller to appear. */
const SCROLLER_RETRIES = 5;

/**
 * Upstream's conversation cap driver (c2d1aeb56 `q`): while `on`, finds the card's scroller (waiting up to five
 * frames for one), measures, and measures again whenever the scroller, its child holding the card, the card's
 * parent, or the card body resizes. Turning off or unmounting disconnects and removes both properties from the card.
 */
export function useApprovalConversationCap(ref: RefObject<HTMLElement | null>, on: boolean): void
{
	useLayoutEffect(() =>
	{
		const card = ref.current;
		const win = windowOf(card);
		if (!on || card === null || win === null) return undefined;
		let frame: number | undefined;
		let tries = 0;
		let stop: (() => void) | undefined;
		const start = () =>
		{
			frame = undefined;
			const scroller = nearestScroller(card, win);
			if (scroller === null)
			{
				if (tries < SCROLLER_RETRIES)
				{
					tries += 1;
					frame = win.requestAnimationFrame(start);
				}
				return;
			}
			const fitter = createConversationCapFitter(card, win, scroller);
			fitter.measure();
			// Without a ResizeObserver (jsdom) the fitter still measures once.
			const Resize = maybe(win.ResizeObserver) ?? maybe(globalThis.ResizeObserver);
			const observer = Resize === undefined ? undefined : new Resize(fitter.measure);
			observer?.observe(scroller);
			observer?.observe(fitter.column);
			observer?.observe(fitter.parent);
			const body = card.querySelector(APPROVAL_BODY_SELECTOR);
			if (body !== null) observer?.observe(body);
			stop = () =>
			{
				observer?.disconnect();
				card.style.removeProperty(APPROVAL_CAP_VAR);
				card.style.removeProperty(APPROVAL_RECLAIM_VAR);
			};
		};
		start();
		return () =>
		{
			if (frame !== undefined) win.cancelAnimationFrame(frame);
			stop?.();
		};
	}, [ref, on]);
}
