import {describe, expect, it} from "vite-plus/test";

import {activeGoal, appendGoalStatusRows, type GoalStatusRow} from "../src/lib/session-goal";

const SET_AT = "2001-01-01T00:00:00.000Z";

function set(condition: string, timestamp = SET_AT): GoalStatusRow
{
	return {
		timestamp,
		attachment:
		{
			met: false,
			sentinel: true,
			condition,
		},
	};
}

function check(condition: string, reason: string): GoalStatusRow
{
	return {
		timestamp: "2001-01-01T00:01:00.000Z",
		attachment:
		{
			met: false,
			condition,
			reason,
		},
	};
}

describe("activeGoal", () =>
{
	it("is null with no rows", () =>
	{
		expect(activeGoal([])).toBeNull();
	});

	it("starts a goal from the /goal sentinel, never checked", () =>
	{
		expect(activeGoal([set("fake goal")])).toStrictEqual(
			{
				condition: "fake goal",
				iterations: 0,
				setAt: 978307200000,
				editText: "fake goal",
			},
		);
	});

	it("counts each not-met check and keeps the newest reason", () =>
	{
		expect(
			activeGoal([
				set("fake goal"),
				check("fake goal", "first fake reason"),
				check("fake goal", "second fake reason"),
			]),
		).toStrictEqual(
			{
				condition: "fake goal",
				iterations: 2,
				setAt: 978307200000,
				lastReason: "second fake reason",
				editText: "fake goal",
			},
		);
	});

	it("keeps only the first line of a multi-line reason, and an empty reason clears it", () =>
	{
		expect(
			{
				multiLine: activeGoal([set("fake goal"), check("fake goal", "  line one\nline two")])?.lastReason,
				cleared: activeGoal([set("fake goal"), check("fake goal", "fake reason"), check("fake goal", "")])
					?.lastReason,
			},
		).toStrictEqual(
			{
				multiLine: "line one",
				cleared: undefined,
			},
		);
	});

	it("changes nothing on a compaction carry of the same condition", () =>
	{
		expect(
			activeGoal([
				set("fake goal"),
				check("fake goal", "fake reason"),
				set("fake goal", "2001-01-02T00:00:00.000Z"),
			]),
		).toStrictEqual(
			{
				condition: "fake goal",
				iterations: 1,
				setAt: 978307200000,
				lastReason: "fake reason",
				editText: "fake goal",
			},
		);
	});

	it("resets on a second /goal with a new condition", () =>
	{
		expect(
			activeGoal([
				set("fake goal"),
				check("fake goal", "fake reason"),
				set("other fake goal", "2001-01-02T00:00:00.000Z"),
			]),
		).toStrictEqual(
			{
				condition: "other fake goal",
				iterations: 0,
				setAt: 978393600000,
				editText: "other fake goal",
			},
		);
	});

	it("ends on a met check, a failed check, or the /goal clear sentinel", () =>
	{
		const ended = (attachment: GoalStatusRow["attachment"]) =>
			activeGoal([
				set("fake goal"),
				{
					attachment,
				},
			]);
		expect([
			ended(
				{
					met: true,
					condition: "fake goal",
					reason: "fake reason",
				},
			),
			ended(
				{
					met: false,
					failed: true,
					condition: "fake goal",
					reason: "fake reason",
				},
			),
			ended(
				{
					met: true,
					sentinel: true,
					condition: "fake goal",
				},
			),
		]).toStrictEqual([null, null, null]);
	});

	it("caps the shown condition at 500 units plus an ellipsis while editText keeps it whole", () =>
	{
		const long = "a".repeat(600);
		expect(activeGoal([set(long)])).toStrictEqual(
			{
				condition: `${"a".repeat(500)}…`,
				iterations: 0,
				setAt: 978307200000,
				editText: long,
			},
		);
	});

	it("never splits a surrogate pair at the cap, and collapses whitespace", () =>
	{
		const condition = `${"a".repeat(499)}😀 tail`;
		expect(activeGoal([set(condition)])?.condition).toBe(`${"a".repeat(499)}…`);
		expect(activeGoal([set("  fake\n\tgoal  ")])).toStrictEqual(
			{
				condition: "fake goal",
				iterations: 0,
				setAt: 978307200000,
				editText: "fake goal",
			},
		);
	});

	it("is null for a blank condition", () =>
	{
		expect(activeGoal([set("   ")])).toBeNull();
	});
});

describe("appendGoalStatusRows", () =>
{
	it("keeps only goal_status attachment records, with their timestamp and the fields the fold reads", () =>
	{
		expect(
			appendGoalStatusRows(
				[],
				[
					{
						type: "user",
						timestamp: SET_AT,
					},
					{
						type: "attachment",
						uuid: "u-goal-set",
						timestamp: SET_AT,
						attachment:
						{
							type: "goal_status",
							met: false,
							sentinel: true,
							condition: "fake goal",
						},
					},
					{
						type: "attachment",
						attachment:
						{
							type: "date_change",
							newDate: "2001-01-02",
						},
					},
					undefined,
				],
			),
		).toStrictEqual([set("fake goal")]);
	});
});
