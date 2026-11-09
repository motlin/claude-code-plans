import {describe, expect, it} from "vite-plus/test";

import {
	COLD_RESUME_COPY,
	COLD_RESUME_IDLE_MS,
	COLD_RESUME_QUOTA,
	coldResumeDetail,
	coldResumePercent,
	type ColdResumeInput,
	decideColdResume,
	formatIdleDuration,
	idleSince,
	newestRecordMs,
	usageWindowSpent,
} from "../src/lib/cold-resume-notice";

describe("constants", () => {
	it("copies upstream's 2h idle boundary and preview quota Bge", () => {
		expect(COLD_RESUME_IDLE_MS).toBe(7_200_000);
		expect(COLD_RESUME_QUOTA).toStrictEqual({percentPerMillionTokens: 40, minPercent: 5});
	});

	it("holds the inferred English copy", () => {
		expect(COLD_RESUME_COPY).toStrictEqual({
			heading: "This session has been idle",
			detail: "Idle {idle}. Resuming will use about {percent} of your 5-hour limit.",
			detailUsesRest: "Idle {idle}. Resuming will likely use the rest of your 5-hour limit.",
			resume: "Resume here",
			newSession: "New session",
			newSessionTip: "Mentions this session",
			compact: "Compact",
			compactTip: "Summarize the conversation so far to make resuming cheaper",
		});
	});
});

describe("coldResumePercent", () => {
	it("rounds tokens / 1M * rate and drops values under minPercent", () => {
		expect(coldResumePercent(412_000, COLD_RESUME_QUOTA)).toBe(16);
		expect(coldResumePercent(124_999, COLD_RESUME_QUOTA)).toBeNull();
		expect(coldResumePercent(125_000, COLD_RESUME_QUOTA)).toBe(5);
	});
});

describe("idleSince", () => {
	it("takes the later of the newest record and last activity", () => {
		expect(idleSince({lastRecordMs: 1000, lastActivityMs: 5000})).toBe(5000);
		expect(idleSince({lastRecordMs: 7000, lastActivityMs: null})).toBe(7000);
		expect(idleSince({lastRecordMs: null, lastActivityMs: null})).toBeNull();
	});
});

describe("formatIdleDuration", () => {
	it("uses whole hours below 2880 minutes and whole days from there", () => {
		expect(formatIdleDuration(120)).toBe("2 hours");
		expect(formatIdleDuration(1579)).toBe("26 hours");
		expect(formatIdleDuration(2879)).toBe("47 hours");
		expect(formatIdleDuration(2880)).toBe("2 days");
	});
});

describe("coldResumeDetail", () => {
	it("fills the normal and uses-the-rest copy", () => {
		expect(coldResumeDetail({idleMinutes: 1579, percent: 16, usesRest: false})).toBe(
			"Idle 26 hours. Resuming will use about 16% of your 5-hour limit.",
		);
		expect(coldResumeDetail({idleMinutes: 1579, percent: 16, usesRest: true})).toBe(
			"Idle 26 hours. Resuming will likely use the rest of your 5-hour limit.",
		);
	});
});

describe("decideColdResume", () => {
	const base: ColdResumeInput = {
		nowMs: 94_740_000,
		since: 0,
		contextTokens: 412_000,
		fiveHourPct: 20,
		anyWindowSpent: false,
		running: false,
		heldInput: false,
		focused: true,
		visible: true,
		answeredSince: null,
		sentOverSince: null,
	};

	it("shows after 2h idle with enough context", () => {
		expect(decideColdResume(base)).toStrictEqual({since: 0, idleMinutes: 1579, percent: 16, usesRest: false});
	});

	it.each<[string, Partial<ColdResumeInput>]>([
		["under 2h", {nowMs: 7_199_999}],
		["no idle start", {since: null}],
		["running", {running: true}],
		["held input", {heldInput: true}],
		["unfocused", {focused: false}],
		["hidden", {visible: false}],
		["a spent window", {anyWindowSpent: true}],
		["unknown five-hour window", {fiveHourPct: null}],
		["unknown context", {contextTokens: null}],
		["small context", {contextTokens: 100_000}],
		["answered this stretch", {answeredSince: 0}],
		["sent over this stretch", {sentOverSince: 0}],
	])("hides when %s", (_label, patch) => {
		expect(decideColdResume({...base, ...patch})).toBeNull();
	});

	it("flags usesRest when the cost reaches the remaining window", () => {
		expect(decideColdResume({...base, fiveHourPct: 90})).toStrictEqual({
			since: 0,
			idleMinutes: 1579,
			percent: 16,
			usesRest: true,
		});
	});
});

describe("newestRecordMs", () => {
	it("reads the newest record's timestamp, skipping records without one", () => {
		expect(
			newestRecordMs([
				{type: "user", timestamp: "2026-11-09T10:00:00.000Z"},
				{type: "assistant", timestamp: "2026-11-09T11:00:00.000Z"},
				{type: "custom-title"},
			]),
		).toBe(Date.parse("2026-11-09T11:00:00.000Z"));
		expect(newestRecordMs([{type: "custom-title"}, {timestamp: 5}])).toBeNull();
		expect(newestRecordMs([])).toBeNull();
	});
});

describe("usageWindowSpent", () => {
	const reset = 2_000;
	it("is true when a window is at 100% before its reset", () => {
		expect(usageWindowSpent(null, 0)).toBe(false);
		expect(
			usageWindowSpent({fiveHour: {usedPercentage: 100, resetsAt: reset}, weekly: null}, reset * 1000 - 1),
		).toBe(true);
		expect(usageWindowSpent({fiveHour: null, weekly: {usedPercentage: 100, resetsAt: reset}}, 0)).toBe(true);
		expect(usageWindowSpent({fiveHour: {usedPercentage: 100, resetsAt: reset}, weekly: null}, reset * 1000)).toBe(
			false,
		);
		expect(usageWindowSpent({fiveHour: {usedPercentage: 99, resetsAt: reset}, weekly: null}, 0)).toBe(false);
	});
});
