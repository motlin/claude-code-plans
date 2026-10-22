import {describe, expect, it} from "vite-plus/test";
import {SHEET_QUERY, decideSheet} from "../src/components/ui/sheet-presentation";

describe("decideSheet", () => {
	it("sheets only for auto under a coarse narrow viewport when closable, or for an explicit sheet, unless structurally anchored", () => {
		const results = [
			decideSheet({presentation: "auto", coarseNarrow: true}),
			decideSheet({presentation: "auto", coarseNarrow: false}),
			decideSheet({presentation: "auto", coarseNarrow: true, closable: false}),
			decideSheet({presentation: "sheet", coarseNarrow: false, closable: false}),
			decideSheet({presentation: "anchored", coarseNarrow: true}),
			decideSheet({presentation: "sheet", coarseNarrow: true, structurallyAnchored: true}),
			decideSheet({presentation: "auto", coarseNarrow: true, structurallyAnchored: true}),
		];
		expect(results).toStrictEqual([true, false, false, true, false, false, false]);
	});

	it("gates on a coarse pointer below 640px", () => {
		expect(SHEET_QUERY).toBe("(pointer: coarse) and (max-width: 639.98px)");
	});
});
