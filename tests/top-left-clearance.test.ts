import {describe, expect, it} from "vite-plus/test";
import {topLeftClearance, topLeftClearanceStyle} from "../src/lib/top-left-clearance";

describe("top-left clearance", () => {
	it("clears the floating 24px toggle at 12,12 when the desktop sidebar is collapsed", () => {
		expect(topLeftClearance(true)).toEqual({start: 41, top: 9});
		expect(topLeftClearanceStyle(true)).toEqual({
			"--top-left-clearance-start": "41px",
			"--top-left-clearance-top": "9px",
		});
	});

	it("adds no clearance while the sidebar is docked", () => {
		expect(topLeftClearance(false)).toBe(null);
		expect(topLeftClearanceStyle(false)).toBe(undefined);
	});
});
