import {describe, expect, it} from "vite-plus/test";
import type {ClientToolCall} from "../src/components/tool-renderers/types";
import type {PermissionDecision} from "../src/lib/permission-decision";
import {countsAsUserAsk, planAsksNudge, SAFETY_NUDGES} from "../src/lib/safety-nudges";

function call(id: string, permission?: PermissionDecision, overrides: Partial<ClientToolCall> = {}): ClientToolCall
{
	return {
		id,
		name: "Bash",
		input: {},
		param: "",
		sourceUuid: `u-${id}`,
		permission,
		...overrides,
	};
}

const ASKED: PermissionDecision =
{
	decision: "accept",
	source: "user_temporary",
};

function asks(count: number): ClientToolCall[]
{
	return Array.from(
		{
			length: count,
		},
		(_, index) => call(`t${index + 1}`, ASKED),
	);
}

const OPEN =
{
	autoOffered: true,
	owned: true,
	memory: {},
};

describe("SAFETY_NUDGES", () =>
{
	it("is off locally until upstream ships the English copy", () =>
	{
		expect(SAFETY_NUDGES).toBe(false);
	});
});

describe("countsAsUserAsk", () =>
{
	it("counts user-answered asks and typed denials, but not questions, plan exits, MCP calls or settings decisions", () =>
	{
		expect(
			[
				call("a", ASKED),
				call(
					"b",
					{
						decision: "reject",
						source: "user_reject",
					},
				),
				call(
					"c",
					undefined,
					{
						denied: true,
					},
				),
				call(
					"d",
					ASKED,
					{
						name: "AskUserQuestion",
					},
				),
				call(
					"e",
					ASKED,
					{
						name: "ExitPlanMode",
					},
				),
				call(
					"f",
					ASKED,
					{
						name: "mcp__x__y",
					},
				),
				call(
					"g",
					{
						decision: "accept",
						source: "user_permanent",
					},
				),
				call(
					"h",
					{
						decision: "accept",
						source: "user_temporary",
						reasonType: "rule",
					},
				),
				call(
					"i",
					{
						decision: "accept",
						source: "classifier",
						reasonType: "classifier",
					},
				),
				call("j"),
			].map(countsAsUserAsk),
		).toStrictEqual([true, true, true, false, false, false, false, false, false, false]);
	});
});

describe("planAsksNudge", () =>
{
	it("plans nothing below 10 asks", () =>
	{
		expect(planAsksNudge(asks(9), OPEN)).toBeNull();
	});

	it("carries the card on the 10th ask and counts every ask in the transcript", () =>
	{
		expect(planAsksNudge(asks(12), OPEN)).toStrictEqual(
			{
				carrierId: "t10",
				count: 12,
			},
		);
	});

	it("skips calls that are not asks when finding the 10th", () =>
	{
		const calls = [
			...asks(5),
			call(
				"q",
				ASKED,
				{
					name: "AskUserQuestion",
				},
			),
			call(
				"m",
				ASKED,
				{
					name: "mcp__x__y",
				},
			),
			call(
				"p",
				{
					decision: "accept",
					source: "user_permanent",
				},
			),
			call(
				"r",
				{
					decision: "accept",
					source: "user_temporary",
					reasonType: "rule",
				},
			),
			...asks(10).slice(5),
		];
		expect(planAsksNudge(calls, OPEN)).toStrictEqual(
			{
				carrierId: "t10",
				count: 10,
			},
		);
	});

	it("honours the session memory: dismissed hides it, another shown kind blocks it, asks shown keeps it", () =>
	{
		expect([
			planAsksNudge(
				asks(10),
				{
					...OPEN,
					memory:
					{
						dismissed: true,
					},
				},
			),
			planAsksNudge(
				asks(10),
				{
					...OPEN,
					memory:
					{
						shown: "repeat",
					},
				},
			),
			planAsksNudge(
				asks(10),
				{
					...OPEN,
					memory:
					{
						shown: "asks",
					},
				},
			),
		]).toStrictEqual([
			null,
			null,
			{
				carrierId: "t10",
				count: 10,
			},
		]);
	});

	it("plans nothing when the mode can't switch to Auto or the session isn't owned", () =>
	{
		expect([
			planAsksNudge(
				asks(10),
				{
					...OPEN,
					autoOffered: false,
				},
			),
			planAsksNudge(
				asks(10),
				{
					...OPEN,
					owned: false,
				},
			),
		]).toStrictEqual([null, null]);
	});
});
