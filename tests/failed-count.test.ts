import {withTrailingFailedCount} from "./failed-count";

describe("withTrailingFailedCount", () =>
{
	it.each([
		{
			specimen: "Ran 2 commands (1 failed), finished a background command",
			expected: "Ran 2 commands, finished a background command, 1 failed",
		},
		{
			specimen: "Finished a background task (1 failed), ran 2 commands (1 failed)",
			expected: "Finished a background task, ran 2 commands, 2 failed",
		},
		{
			specimen: "status: Hook re-prompted Claude, ran a command (1 failed)",
			expected: "status: Hook re-prompted Claude, ran a command, 1 failed",
		},
		{
			specimen: "Ran 3 commands (1 failed)",
			expected: "Ran 3 commands (1 failed)",
		},
		{
			specimen: "status: Ran 3 commands (1 failed)",
			expected: "status: Ran 3 commands (1 failed)",
		},
		{
			specimen: "Ran 2 commands, read a file",
			expected: "Ran 2 commands, read a file",
		},
	])("reads $specimen as $expected", ({specimen, expected}) =>
	{
		expect(withTrailingFailedCount(specimen)).toBe(expected);
	});
});
