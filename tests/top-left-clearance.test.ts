import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";
import
{
	PHONE_SIDEBAR_TOGGLE,
	TITLEBAR_HEIGHT_PX,
	topLeftClearance,
	topLeftClearanceStyle,
} from "../src/lib/top-left-clearance";
import {ruleStart} from "./css-rule";

describe("top-left clearance", () =>
{
	it("clears the floating 24px toggle at 12,12 when the desktop sidebar is collapsed", () =>
	{
		expect(topLeftClearance("collapsed")).toEqual(
			{
				start: 41,
				top: 9,
			},
		);
		expect(topLeftClearanceStyle("collapsed")).toStrictEqual(
			{
				"--top-left-clearance-start": "41px",
				"--top-left-clearance-top": "9px",
				// Upstream shared-styles `--cds-page-header-start-clearance: calc(var(--df-trigger-right) + 8px)`, set only while
				// collapsed: the toggle's right edge (12 + 24 = 36) plus 8.
				"--cds-page-header-start-clearance": "44px",
			},
		);
	});

	it("adds no clearance while the sidebar is docked", () =>
	{
		expect(topLeftClearance("docked")).toBe(null);
		expect(topLeftClearanceStyle("docked")).toBe(undefined);
	});

	it("sets the phone toggle 8px down at x=8 and the titlebar row at x=41, 9px down, as upstream's phone header", () =>
	{
		expect(
			{
				toggle: PHONE_SIDEBAR_TOGGLE,
				clearance: topLeftClearance("phone"),
				style: topLeftClearanceStyle("phone"),
				barHeight: TITLEBAR_HEIGHT_PX,
			},
		).toStrictEqual(
			{
				toggle:
				{
					left: 8,
					top: 8,
					size: 32,
				},
				clearance:
				{
					start: 41,
					top: 9,
				},
				style:
				{
					"--top-left-clearance-start": "41px",
					"--top-left-clearance-top": "9px",
				},
				barHeight: 32,
			},
		);
	});

	it("drops a phone tile's content by that clearance, so its titlebar row starts at y=9", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const start = ruleStart(styles, "[data-route-tile-shell]");
		const rule = styles.slice(start, styles.indexOf("}", start));

		expect(
			rule.split("\n").some((line) => line.trim() === "padding-top: var(--top-left-clearance-top, 0px);"),
		).toBe(true);
	});
});
