import {createContext, useCallback, useContext, useState} from "react";
import {useMediaQuery} from "../../lib/use-phone-sheet";

/** Upstream cds `m5`: overlays turn into bottom sheets only under a coarse pointer below 640px. */
export const SHEET_QUERY = "(pointer: coarse) and (max-width: 639.98px)";

type Presentation = "auto" | "sheet" | "anchored";

interface SheetDecisionInput {
	presentation: Presentation;
	coarseNarrow: boolean;
	closable?: boolean;
	structurallyAnchored?: boolean;
}

/**
 * Mirrors upstream `uK`: `vm(presentation, false, coarseNarrow) && (closable || presentation === "sheet")`,
 * then `!structurallyAnchored`. A structurally anchored overlay beats even an explicit `"sheet"`.
 */
export function decideSheet({
	presentation,
	coarseNarrow,
	closable = true,
	structurallyAnchored = false,
}: SheetDecisionInput): boolean {
	if (structurallyAnchored) return false;
	return presentation === "auto" ? coarseNarrow && closable : presentation === "sheet";
}

/** Upstream cds `al`: the presentation an overlay subtree asks for; `"auto"` lets the width gate decide. */
const PresentationContext = createContext<Presentation>("auto");

interface SheetPresentationOptions {
	closable?: boolean;
	structurallyAnchored?: boolean;
}

interface SheetLatch {
	open: boolean;
	showing: boolean;
	sheet: boolean;
}

/**
 * Mirrors upstream `uK`'s `TR(decision, open, showing)`: the sheet decision is taken when `open` flips
 * and held while the overlay is open or still animating out, so resizing or rotating never morphs an
 * open overlay. Pass `onOpenChangeComplete` to Base UI so the latch releases once the exit finishes.
 */
export function useSheetPresentation(
	open: boolean,
	{closable, structurallyAnchored}: SheetPresentationOptions = {},
): {sheet: boolean; onOpenChangeComplete: (open: boolean) => void} {
	const presentation = useContext(PresentationContext);
	const coarseNarrow = useMediaQuery(SHEET_QUERY);
	const live = decideSheet({
		presentation,
		coarseNarrow,
		...(closable === undefined ? {} : {closable}),
		...(structurallyAnchored === undefined ? {} : {structurallyAnchored}),
	});
	const [latch, setLatch] = useState<SheetLatch>({open, showing: open, sheet: live});
	let current = latch;
	if (latch.open !== open) {
		current = open ? {open, showing: true, sheet: live} : {...latch, open};
		setLatch(current);
	}
	const onOpenChangeComplete = useCallback((completedOpen: boolean) => {
		if (completedOpen) return;
		setLatch((previous) => (previous.open ? previous : {...previous, showing: false}));
	}, []);
	return {sheet: current.open || current.showing ? current.sheet : live, onOpenChangeComplete};
}
