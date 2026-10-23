import {describe, expect, test} from "vite-plus/test";

import {summarizeFailure} from "./verify-log.mjs";

describe("summarizeFailure", () => {
	test("names the failing vitest files, tests and just recipes", () => {
		const log = [
			"fallow...................................................................Passed",
			" ✓  shared  tests/db.test.ts (12 tests) 120ms",
			" \u001b[31m❯\u001b[39m  isolated  tests/hook-dispatcher.test.ts (60 tests | 1 failed) 32277ms",
			"       \u001b[31m×\u001b[39m only broadcasts plan:changed once when PostToolUse fires then watcher trails 4062ms",
			"         → expected 2 to be 1",
			" FAIL   isolated  tests/hook-dispatcher.test.ts > only broadcasts plan:changed once",
			"AssertionError: expected 2 to be 1",
			" Test Files  1 failed | 706 passed (707)",
			"      Tests  1 failed | 8421 passed | 2 skipped (8424)",
			"error: recipe `_test` failed on line 75 with exit code 1",
			"error: recipe `_verify-test` failed on line 189 with exit code 1",
			"",
		].join("\n");
		expect(summarizeFailure(log)).toStrictEqual([
			" ❯  isolated  tests/hook-dispatcher.test.ts (60 tests | 1 failed) 32277ms",
			"       × only broadcasts plan:changed once when PostToolUse fires then watcher trails 4062ms",
			" FAIL   isolated  tests/hook-dispatcher.test.ts > only broadcasts plan:changed once",
			" Test Files  1 failed | 706 passed (707)",
			"      Tests  1 failed | 8421 passed | 2 skipped (8424)",
			"error: recipe `_test` failed on line 75 with exit code 1",
			"error: recipe `_verify-test` failed on line 189 with exit code 1",
		]);
	});

	test("names lint diagnostics and failing checks", () => {
		const log = [
			"  × typescript(TS2550): Property 'withResolvers' does not exist on type 'PromiseConstructor'.",
			"Found 4 errors and 14 warnings in 1855 files (12.7s, 16 threads)",
			"bundle.home.raw rose from 1199269 to 1211362; fix the regression or raise the ceiling with a reason",
			"error: recipe `check` failed on line 71 with exit code 1",
		].join("\n");
		expect(summarizeFailure(log)).toStrictEqual([
			"  × typescript(TS2550): Property 'withResolvers' does not exist on type 'PromiseConstructor'.",
			"error: recipe `check` failed on line 71 with exit code 1",
		]);
	});

	test("falls back to the last lines when nothing names the failure", () => {
		const lines = Array.from({length: 30}, (_, index) => `line ${index}`);
		expect(summarizeFailure([...lines, "", "Killed: 9", ""].join("\n"))).toStrictEqual([
			...lines.slice(-14),
			"Killed: 9",
		]);
	});

	test("caps a long list of failures and says how many were left out", () => {
		const log = Array.from({length: 50}, (_, index) => `       × test ${index}`).join("\n");
		expect(summarizeFailure(log)).toStrictEqual([
			...Array.from({length: 40}, (_, index) => `       × test ${index}`),
			"… 10 more failure lines in the log",
		]);
	});
});
