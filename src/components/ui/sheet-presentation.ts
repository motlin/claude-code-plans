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
