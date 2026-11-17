import {useRouter, useRouterState} from "@tanstack/react-router";
import {useEffect, useEffectEvent, useRef} from "react";

import
{
	PALETTE_OVERLAY_SELECTOR,
	type PaletteAutoCloseReason,
	type PaletteCloseHold,
	shouldAutoClose,
} from "../lib/palette-close-hold";

export interface PaletteAutoCloseOptions
{
	/** Upstream `v9(isOpen)`: the palette is open (not just still mounted for its exit). */
	enabled: boolean;
	hold: PaletteCloseHold;
	onClose: (reason: PaletteAutoCloseReason) => void;
}

/** Upstream `vC`: pathnames compare with `decodeURI` tolerance. */
function samePathname(a: string, b: string): boolean
{
	if (a === b) return true;
	try
	{
		return decodeURI(a) === decodeURI(b);
	}
	catch
	{
		return false;
	}
}

function openOverlays(): Set<Element>
{
	return new Set(document.body.querySelectorAll(PALETTE_OVERLAY_SELECTOR));
}

/**
 * Port of upstream `A7`: closes the open palette when the pathname changes or another modal dialog opens,
 * unless the hold refuses it. A dialog refused under an `all` hold closes the palette once the hold drops to
 * `none`, if that dialog is still open. Base UI portals every local dialog to `body`, so `body` is watched.
 */
export function usePaletteAutoClose({enabled, hold, onClose}: PaletteAutoCloseOptions): void
{
	const router = useRouter();
	const pathname = useRouterState(
		{
			select: (state) => (state.resolvedLocation ?? state.location).pathname,
		},
	);
	const close = useEffectEvent((reason: PaletteAutoCloseReason): boolean =>
	{
		if (!shouldAutoClose(hold, reason)) return false;
		onClose(reason);
		return true;
	});

	// `arriving`: the in-flight pathname at open, so a palette opened mid-navigation survives it landing.
	const routeRef = useRef(
		{
			enabled: false,
			pathname,
			arriving: "",
		},
	);
	useEffect(() =>
	{
		const previous = routeRef.current;
		const opening = enabled && !previous.enabled;
		const moved = previous.pathname !== pathname;
		routeRef.current =
		{
			enabled,
			pathname,
			arriving: opening ? router.state.location.pathname : moved ? "" : previous.arriving,
		};
		if (enabled && !opening && moved && !samePathname(pathname, previous.arriving)) close("route");
	}, [pathname, enabled, router]);

	const pendingRef = useRef(new Set<Element>());
	useEffect(() =>
	{
		if (!enabled) return undefined;
		const pending = pendingRef.current;
		let known = openOverlays();
		const observer = new MutationObserver(() =>
		{
			const current = openOverlays();
			const added = [...current].filter((node) => !known.has(node));
			known = current;
			if (added.length === 0 || close("dialog")) return;
			for (const node of added) pending.add(node);
		});
		observer.observe(
			document.body,
			{
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["data-open", "data-closed"],
			},
		);
		return () =>
		{
			observer.disconnect();
			pending.clear();
		};
	}, [enabled]);

	useEffect(() =>
	{
		if (hold !== "none") return;
		const stillOpen = [...pendingRef.current].some(
			(node) => node.isConnected && node.matches(PALETTE_OVERLAY_SELECTOR),
		);
		pendingRef.current.clear();
		if (stillOpen) close("dialog");
	}, [hold]);
}
