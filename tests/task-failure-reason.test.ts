import {describe, expect, it} from "vite-plus/test";
import type {BackgroundTaskStatus} from "../src/lib/background-tasks";
import {taskFailureReason} from "../src/lib/task-failure-reason";

describe("taskFailureReason", () =>
{
	it("ports upstream's NO: the text after the quoted description, minus failed, first line, one trailing dot", () =>
	{
		const long = "d".repeat(990) + "tail of the description words";
		const cases: [BackgroundTaskStatus, string, string][] = [
			[
				"failed",
				'Background command "Start dev server on spare port" failed with exit code 143',
				"Start dev server on spare port",
			],
			["failed", 'Agent "Review the fabricated diff" failed: stalled', "Review the fabricated diff"],
			["failed", 'Monitor "brute finished" script failed (exit 144)', "brute finished"],
			["failed", 'Workflow "x" failed', "x"],
			["failed", 'Background command "x" failed with exit code 1.', "x"],
			["failed", 'Background command "x" failed: line one\nline two', "x"],
			["completed", 'Background command "x" failed with exit code 1', "x"],
			["failed", "Serve production from the new worktree", "Serve production from the new worktree"],
			["failed", `Agent "${long.slice(0, 950)}…${long.slice(-50)}" failed: too long`, long],
			["failed", 'Background command "x" failed: \u001b[31mboom\u001b[0m', "x"],
		];
		expect(
			cases.map(([status, summary, description]) =>
				taskFailureReason(
					{
						status,
						summary,
						description,
					},
				),
			),
		).toStrictEqual([
			"exit code 143",
			"stalled",
			"script failed (exit 144)",
			undefined,
			"exit code 1",
			"line one",
			undefined,
			undefined,
			"too long",
			"boom",
		]);
	});
});
