import {DEFAULT_VIRTUAL_FILE_METRICS} from "@pierre/diffs";
import {describe, expect, it} from "vite-plus/test";
import {
	DEFAULT_DIFF_METRICS,
	DIFF_DENSITY_LINE_HEIGHT,
	changesDiffMetrics,
	diffLineHeightStyle,
	diffMetrics,
} from "../src/components/changes/diffs-config";

describe("diffMetrics (upstream ca7ba268c ga/ya/za)", () => {
	it("starts from pierre's virtual file metrics with the density's code leading", () => {
		expect({
			defaults: DEFAULT_DIFF_METRICS,
			pierre: DEFAULT_VIRTUAL_FILE_METRICS,
			density: DIFF_DENSITY_LINE_HEIGHT,
			compact: diffMetrics({density: "compact"}),
			comfortable: diffMetrics({density: "comfortable"}),
		}).toStrictEqual({
			defaults: {hunkLineCount: 50, lineHeight: 20, diffHeaderHeight: 44, spacing: 8},
			pierre: {hunkLineCount: 50, lineHeight: 20, diffHeaderHeight: 44, spacing: 8},
			density: {compact: 17, comfortable: 19},
			compact: {hunkLineCount: 50, lineHeight: 17, diffHeaderHeight: 44, spacing: 8},
			comfortable: {hunkLineCount: 50, lineHeight: 19, diffHeaderHeight: 44, spacing: 8},
		});
	});

	it("lets the caller's metrics win, and zeroes the header with spacing as top padding when it is disabled", () => {
		expect({
			caller: diffMetrics({density: "compact", metrics: {lineHeight: 20, diffHeaderHeight: 32}}),
			headerless: diffMetrics({density: "compact", disableFileHeader: true}),
			padded: diffMetrics({density: "compact", disableFileHeader: true, metrics: {paddingTop: 4}}),
		}).toStrictEqual({
			caller: {hunkLineCount: 50, lineHeight: 20, diffHeaderHeight: 32, spacing: 8},
			headerless: {hunkLineCount: 50, lineHeight: 17, diffHeaderHeight: 0, spacing: 8, paddingTop: 8},
			padded: {hunkLineCount: 50, lineHeight: 17, diffHeaderHeight: 0, spacing: 8, paddingTop: 4},
		});
	});

	it("writes the inline --diffs-line-height only for a caller's lineHeight", () => {
		expect({
			none: diffLineHeightStyle(undefined),
			spacingOnly: diffLineHeightStyle({spacing: 8}),
			lineHeight: diffLineHeightStyle({lineHeight: 20}),
		}).toStrictEqual({
			none: {},
			spacingOnly: {},
			lineHeight: {"--diffs-line-height": "20px"},
		});
	});

	it("builds the Changes pane metrics from comfortable defaults with a 32px header and ×1.5 rows (upstream c82eca2bd c())", () => {
		expect({
			defaultSize: changesDiffMetrics(null),
			viaDiffMetrics: diffMetrics({density: "comfortable", metrics: {lineHeight: 20, diffHeaderHeight: 32}}),
			twenty: changesDiffMetrics(20),
		}).toStrictEqual({
			defaultSize: {hunkLineCount: 50, lineHeight: 20, diffHeaderHeight: 32, spacing: 8},
			viaDiffMetrics: {hunkLineCount: 50, lineHeight: 20, diffHeaderHeight: 32, spacing: 8},
			twenty: {hunkLineCount: 50, lineHeight: 30, diffHeaderHeight: 32, spacing: 8},
		});
	});
});
