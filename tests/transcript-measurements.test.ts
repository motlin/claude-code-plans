import {afterEach, expect, it, vi} from "vite-plus/test";
import {
	readTranscriptMeasurements,
	discardTranscriptMeasurements,
	rememberTranscriptMeasurements,
	rememberTranscriptHandoff,
	takeTranscriptHandoff,
} from "../src/lib/transcript-measurements";

const range = {startIndex: 0, endIndex: 4};

afterEach(() => vi.restoreAllMocks());

it("consumes a pane handoff only within its commit and for its original source", async () => {
	const source = {};
	const snapshot = {
		source,
		width: 800,
		range,
		heights: new Map([["example-row-100", 200]]),
		anchor: {entryKey: "example-row-100", offset: -50, atEnd: false},
	};
	rememberTranscriptHandoff("example-handoff", snapshot);
	const sameCommit = takeTranscriptHandoff("example-handoff", source);
	const consumed = takeTranscriptHandoff("example-handoff", source);
	rememberTranscriptHandoff("example-handoff", snapshot);
	const foreignSource = takeTranscriptHandoff("example-handoff", {});
	rememberTranscriptHandoff("example-handoff", snapshot);
	await Promise.resolve();
	const laterCommit = takeTranscriptHandoff("example-handoff", source);
	expect({sameCommit, consumed, foreignSource, laterCommit}).toStrictEqual({
		sameCommit: snapshot,
		consumed: undefined,
		foreignSource: undefined,
		laterCommit: undefined,
	});
});

it("peeks without consuming a generation and snapshots without sharing its mutable height map", () => {
	const source = {};
	const heights = new Map([["example-row-100", 200]]);
	rememberTranscriptMeasurements("example-pure-visit", {width: 800, range, heights}, source);
	heights.set("example-row-100", 300);
	const first = readTranscriptMeasurements("example-pure-visit", source);
	const second = readTranscriptMeasurements("example-pure-visit", source);
	discardTranscriptMeasurements("example-pure-visit");
	expect({first, second, afterClaim: readTranscriptMeasurements("example-pure-visit", source)}).toStrictEqual({
		first: {width: 800, range, heights: new Map([["example-row-100", 200]])},
		second: {width: 800, range, heights: new Map([["example-row-100", 200]])},
		afterClaim: undefined,
	});
});

it("rejects replaced or garbage-collected transcript identity without scanning records", () => {
	const source = {};
	rememberTranscriptMeasurements(
		"example-source-visit",
		{width: 800, range, heights: new Map([["example-row-100", 200]])},
		source,
	);
	const changed = readTranscriptMeasurements("example-source-visit", {});
	vi.spyOn(WeakRef.prototype, "deref").mockReturnValue(undefined);
	const expired = readTranscriptMeasurements("example-source-visit", source);
	discardTranscriptMeasurements("example-source-visit");
	expect({changed, expired}).toStrictEqual({changed: undefined, expired: undefined});
});

it("evicts whole oldest visits at the visit-count limit", () => {
	const source = {};
	for (let index = 0; index < 17; index++)
		rememberTranscriptMeasurements(
			`example-count-${index}`,
			{width: 800, range, heights: new Map([[`row-${index}`, 200]])},
			source,
		);
	const recovered = Array.from({length: 17}, (_, index) => {
		const value = readTranscriptMeasurements(`example-count-${index}`, source);
		discardTranscriptMeasurements(`example-count-${index}`);
		return value;
	});
	expect(recovered).toStrictEqual([
		undefined,
		...Array.from({length: 16}, (_, index) => ({width: 800, range, heights: new Map([[`row-${index + 1}`, 200]])})),
	]);
});

it("caps retained row measurements and rejects an oversized single visit", () => {
	const source = {};
	const heights = new Map(Array.from({length: 2500}, (_, index) => [`row-${index}`, 200]));
	rememberTranscriptMeasurements("example-budget-first", {width: 800, range, heights}, source);
	rememberTranscriptMeasurements("example-budget-second", {width: 800, range, heights}, source);
	const first = readTranscriptMeasurements("example-budget-first", source);
	const second = readTranscriptMeasurements("example-budget-second", source);
	rememberTranscriptMeasurements(
		"example-budget-oversized",
		{width: 800, range, heights: new Map(Array.from({length: 4097}, (_, index) => [`row-${index}`, 200]))},
		source,
	);
	const oversized = readTranscriptMeasurements("example-budget-oversized", source);
	for (const key of ["example-budget-first", "example-budget-second", "example-budget-oversized"])
		discardTranscriptMeasurements(key);
	expect({first, second, oversized}).toStrictEqual({
		first: undefined,
		second: {width: 800, range, heights},
		oversized: undefined,
	});
});
