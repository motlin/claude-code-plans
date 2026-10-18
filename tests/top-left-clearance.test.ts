import {readFileSync} from "node:fs";
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

	it("sets the phone toggle 8px down at x=8 and the titlebar row at x=41, 9px down, as upstream's phone header", () => {
		expect({
			toggle: PHONE_SIDEBAR_TOGGLE,
			clearance: topLeftClearance("phone"),
			style: topLeftClearanceStyle("phone"),
			barHeight: TITLEBAR_HEIGHT_PX,
		}).toStrictEqual({
			toggle: {left: 8, top: 8, size: 32},
			clearance: {start: 41, top: 9},
			style: {"--top-left-clearance-start": "41px", "--top-left-clearance-top": "9px"},
			barHeight: 32,
		});
	});

	it("drops a phone tile's content by that clearance, so its titlebar row starts at y=9", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const start = styles.indexOf("[data-route-tile-shell] {");
		const rule = styles.slice(start, styles.indexOf("}", start));

		expect(
			rule.split("\n").some((line) => line.trim() === "padding-top: var(--top-left-clearance-top, 0px);"),
		).toBe(true);
	});
});
