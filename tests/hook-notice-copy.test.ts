import {describe, expect, it} from "vite-plus/test";

import {foldsIntoToolRun, hookNoticeText} from "../src/lib/hook-notice-copy";

describe("hookNoticeText", () => {
	it("words each notice as upstream's m_ copy does", () => {
		expect([
			hookNoticeText("plain text"),
			hookNoticeText({notice: "away_summary", recap: "x"}),
			hookNoticeText({notice: "agents_killed"}),
			hookNoticeText({notice: "memory_saved", count: 3, teamCount: 0}),
			hookNoticeText({notice: "memory_saved", count: 1, teamCount: 0}),
			hookNoticeText({notice: "memory_saved", count: 2, teamCount: 1}),
			hookNoticeText({notice: "memory_saved", count: 0, teamCount: 2}),
			hookNoticeText({notice: "memory_saved", count: 0, teamCount: 1}),
			hookNoticeText({notice: "memory_saved", count: 4, teamCount: 0, verb: "Improved"}),
		]).toStrictEqual([
			"plain text",
			"Recap: x",
			"All background agents stopped",
			"Saved 3 memories",
			"Saved 1 memory",
			"Saved 2 memories · 1 team memory",
			"Saved 2 team memories",
			"Saved 1 team memory",
			"Improved 4 memories",
		]);
	});
});

describe("foldsIntoToolRun", () => {
	it("folds notice-level lines unless a notice is a warning or a recap", () => {
		expect([
			foldsIntoToolRun([{message: "plain", level: "notice"}]),
			foldsIntoToolRun([{message: {notice: "agents_killed"}, level: "notice"}]),
			foldsIntoToolRun([{message: {notice: "memory_saved", count: 1, teamCount: 0}, level: "notice"}]),
			foldsIntoToolRun([{message: "careful", level: "warning"}]),
			foldsIntoToolRun([{message: {notice: "away_summary", recap: "x"}, level: "notice"}]),
			foldsIntoToolRun([
				{message: "plain", level: "notice"},
				{message: {notice: "away_summary", recap: "x"}, level: "notice"},
			]),
		]).toStrictEqual([true, true, true, false, false, false]);
	});
});
