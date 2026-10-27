import {createContext, useCallback, useContext, useId, useMemo, useRef, useState, type RefObject} from "react";

import {useSessionRailShown} from "../../lib/session-rail-store";
import {usePhoneSheet} from "../../lib/use-phone-sheet";
import {useOptionalPaneHost} from "../panes/pane-host-context";
import {railFit, railFits, type RailFit} from "./rail-fit";

/** The chat tile's measured width and the raised overlay it falls back to when the rail doesn't fit. */
export interface SessionRailFit {
	/** The tile's fit band, undefined until measured with a laid-out width (so SSR docks by the pref alone). */
	band: RailFit | undefined;
	measureRef: (node: HTMLElement | null) => void;
	/** Upstream's raised overlay: local, never the persisted rail flag. */
	raised: boolean;
	setRaised: (raised: boolean) => void;
	overlayId: string;
	toggleRef: RefObject<HTMLButtonElement | null>;
}

export const SessionRailFitContext = createContext<SessionRailFit | null>(null);

/** Owns one chat tile's fit state; attach `measureRef` to the tile root and provide the result. */
export function useSessionRailFitState(): SessionRailFit {
	const [band, setBand] = useState<RailFit>();
	const [raised, setRaised] = useState(false);
	const overlayId = useId();
	const toggleRef = useRef<HTMLButtonElement>(null);
	const observer = useRef<ResizeObserver>(null);
	const measureRef = useCallback((node: HTMLElement | null) => {
		observer.current?.disconnect();
		observer.current = null;
		if (node === null || typeof ResizeObserver === "undefined") return;
		const measure = () => {
			// Only the band is state, so resizing within one doesn't re-render the tile.
			const {width} = node.getBoundingClientRect();
			setBand(width > 0 ? railFit(width) : undefined);
		};
		measure();
		observer.current = new ResizeObserver(measure);
		observer.current.observe(node);
	}, []);
	return useMemo(
		() => ({band, measureRef, raised, setRaised, overlayId, toggleRef}),
		[band, measureRef, raised, overlayId],
	);
}

/**
 * The fit state while the rail can't dock in the chat tile (upstream: under 611px, or
 * 771px beside a pane), so the toggle raises an overlay instead; null while it docks by
 * the pref, unmeasured, or on a phone, where the pref floats it over the transcript.
 */
export function useSessionRailRaise(): SessionRailFit | null {
	const fit = useContext(SessionRailFitContext);
	const host = useOptionalPaneHost();
	const phone = usePhoneSheet();
	if (fit?.band === undefined || phone) return null;
	return railFits(fit.band, (host?.openKinds.length ?? 0) > 0) ? null : fit;
}

/**
 * Whether the rail shows: toggled on and with no side pane open. A pane and the
 * rail share the right side, so opening one swaps the rail out and closing it
 * brings the rail back.
 */
export function useSessionRailVisible(): boolean {
	const shown = useSessionRailShown();
	const host = useOptionalPaneHost();
	return shown && (host?.openKinds.length ?? 0) === 0;
}

/** Whether the rail docks beside the chat: visible, fitting the tile, and not on a phone (where it floats instead). */
export function useSessionRailDocked(): boolean {
	const visible = useSessionRailVisible();
	const raise = useSessionRailRaise();
	const phone = usePhoneSheet();
	return visible && raise === null && !phone;
}
