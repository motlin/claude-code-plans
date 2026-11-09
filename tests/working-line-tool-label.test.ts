import {describe, expect, it} from "vite-plus/test";

import {
	clockHidden,
	TOOL_CLOCK_HOLD_MS,
	toolLabelSince,
	waitedMsSince,
	workingLineLabelSource,
	type WorkingLineToolLabel,
	type WorkingMarkerState,
} from "../src/lib/working-marker";

const WORKING: WorkingMarkerState = {
	status: "working",
	label: "Working…",
	thinking: false,
	replied: true,
	turnStartedAt: 0,
	elapsedSeconds: 20,
};
const TOOL: WorkingLineToolLabel = {words: "Reading foo.ts", unspoken: false, since: 15_000};

describe("workingLineLabelSource", () => {
	it.each<{
		name: string;
		state: WorkingMarkerState;
		phase: string | null;
		toolLabel: WorkingLineToolLabel | null;
		source: string;
	}>([
		{
			name: "Stopping beats the tool words",
			state: {status: "stopping"},
			phase: null,
			toolLabel: TOOL,
			source: "stopping",
		},
		{
			name: "a retry beats the tool words",
			state: {
				status: "retrying",
				error: "overloaded",
				attempt: 1,
				maxRetries: 3,
				turnStartedAt: 0,
				elapsedSeconds: 4,
			},
			phase: null,
			toolLabel: TOOL,
			source: "retry",
		},
		{
			name: "the sending phase beats the tool words",
			state: WORKING,
			phase: "Sending…",
			toolLabel: TOOL,
			source: "phase",
		},
		{name: "the tool words beat the turn stats", state: WORKING, phase: null, toolLabel: TOOL, source: "tool"},
		{name: "with no words the stats show", state: WORKING, phase: null, toolLabel: null, source: "stats"},
	])("$name", ({state, phase, toolLabel, source}) => {
		expect(workingLineLabelSource({state, phase, toolLabel})).toBe(source);
	});
});

describe("waitedMsSince", () => {
	it("sums the permission waits after the given time, an open wait counting nothing", () => {
		expect([
			waitedMsSince([{from: 1000, to: 4000}], 2000),
			waitedMsSince([{from: 5000, to: null}], 2000),
			waitedMsSince([{from: 1000, to: 1500}], 2000),
			waitedMsSince(
				[
					{from: 1000, to: 4000},
					{from: 6000, to: 7000},
				],
				0,
			),
		]).toStrictEqual([2000, 0, 0, 4000]);
	});
});

describe("toolLabelSince", () => {
	it("counts from the call's own start, never before the turn's, plus the permission waits since then", () => {
		expect([
			toolLabelSince({callStartedAt: 10_000, turnStartedAt: 5_000, waits: [{from: 11_000, to: 14_000}]}),
			toolLabelSince({callStartedAt: 2_000, turnStartedAt: 5_000, waits: []}),
			toolLabelSince({callStartedAt: null, turnStartedAt: 5_000, waits: [{from: 6_000, to: 7_000}]}),
		]).toStrictEqual([13_000, 5_000, 6_000]);
	});
});

describe("clockHidden", () => {
	it("hides the clock for 2s after the call's words clear", () => {
		expect([
			TOOL_CLOCK_HOLD_MS,
			clockHidden({now: 11_500, endedAt: 10_000}),
			clockHidden({now: 12_100, endedAt: 10_000}),
			clockHidden({now: 11_500, endedAt: null}),
		]).toStrictEqual([2000, true, false, false]);
	});
});
