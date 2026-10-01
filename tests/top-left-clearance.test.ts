import {describe, expect, it} from "vite-plus/test";
import {
	PHONE_SIDEBAR_TOGGLE,
	TITLEBAR_HEIGHT_PX,
	topLeftClearance,
	topLeftClearanceStyle,
} from "../src/lib/top-left-clearance";

describe("top-left clearance", () => {
	it("clears the floating 24px toggle at 12,12 when the desktop sidebar is collapsed", () => {
		expect(topLeftClearance("collapsed")).toEqual({start: 41, top: 9});
		expect(topLeftClearanceStyle("collapsed")).toEqual({
			"--top-left-clearance-start": "41px",
			"--top-left-clearance-top": "9px",
		});
	});

	it("adds no clearance while the sidebar is docked", () => {
		expect(topLeftClearance("docked")).toBe(null);
		expect(topLeftClearanceStyle("docked")).toBe(undefined);
	});

	it("puts the phone toggle in the titlebar's lead slot so the title starts after it at 390px", () => {
		const clearance = topLeftClearance("phone");
		if (clearance === null) throw new Error("phone clearance missing");
		const toggle = PHONE_SIDEBAR_TOGGLE;

		expect({
			toggle,
			clearance,
			titleStartsAfterToggle: clearance.start > toggle.left + toggle.size,
			toggleCentredInBar: toggle.top * 2 + toggle.size === TITLEBAR_HEIGHT_PX,
			style: topLeftClearanceStyle("phone"),
		}).toStrictEqual({
			toggle: {left: 16, top: 4, size: 24},
			clearance: {start: 44, top: 0},
			titleStartsAfterToggle: true,
			toggleCentredInBar: true,
			style: {"--top-left-clearance-start": "44px", "--top-left-clearance-top": "0px"},
		});
	});
});
