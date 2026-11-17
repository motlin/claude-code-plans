import {describe, expect, it} from "vite-plus/test";

import
{
	ADVISOR_ARGUMENT_HINT,
	ADVISOR_OPTIONS,
	advisorOptionFor,
	advisorOptionLabel,
	isBareAdvisorCommand,
	sessionAdvisorModel,
} from "../src/lib/advisor";

describe("advisorOptionFor", () =>
{
	it("maps a model id to upstream's option by token, null to off, and anything else to unknown", () =>
	{
		const inputs: (string | null | undefined)[] = [
			undefined,
			null,
			"claude-opus-5-5",
			"claude-fable-5-1",
			"claude-sonnet-5",
			"claude-haiku-4-5",
			"opusplan",
		];
		expect(inputs.map((model) => advisorOptionFor(model))).toStrictEqual([
			undefined,
			"off",
			"opus",
			"fable",
			"sonnet",
			undefined,
			undefined,
		]);
	});
});

describe("advisor options", () =>
{
	it("lists upstream's options, labels and argument hint", () =>
	{
		expect(
			{
				options: ADVISOR_OPTIONS,
				labels: ADVISOR_OPTIONS.map((option) => advisorOptionLabel(option)),
				hint: ADVISOR_ARGUMENT_HINT,
			},
		).toStrictEqual(
			{
				options: ["fable", "opus", "sonnet", "off"],
				labels: ["Fable", "Opus", "Sonnet", "Off"],
				hint: "[fable|opus|sonnet|off]",
			},
		);
	});
});

describe("isBareAdvisorCommand", () =>
{
	it("matches only a bare /advisor, ignoring case and surrounding space", () =>
	{
		expect(
			["/advisor", " /ADVISOR ", "/advisor opus", "/advisors"].map((text) => isBareAdvisorCommand(text)),
		).toStrictEqual([true, true, false, false]);
	});
});

function assistant(fields: Record<string, unknown> = {}, model = "claude-opus-5-5"): Record<string, unknown>
{
	return {
		type: "assistant",
		message:
		{
			model,
		},
		...fields,
	};
}

describe("sessionAdvisorModel", () =>
{
	it("reads the last main-thread assistant line's advisorModel, else settings before the first turn", () =>
	{
		const user =
		{
			type: "user",
		};
		expect(
			{
				lastHasIt: sessionAdvisorModel(
					[
						assistant(),
						assistant(
							{
								advisorModel: "claude-opus-5-5",
							},
						),
					],
					{},
				),
				turnedOff: sessionAdvisorModel(
					[
						assistant(
							{
								advisorModel: "claude-opus-5-5",
							},
						),
						user,
						assistant(),
					],
					{
						advisorModel: "fable",
					},
				),
				sidechainIgnored: sessionAdvisorModel(
					[
						assistant(
							{
								advisorModel: "claude-fable-5-1",
							},
						),
						assistant(
							{
								isSidechain: true,
							},
						),
					],
					{},
				),
				syntheticIgnored: sessionAdvisorModel(
					[
						assistant(
							{
								advisorModel: "claude-fable-5-1",
							},
						),
						assistant({}, "<synthetic>"),
					],
					{},
				),
				fromSettings: sessionAdvisorModel(
					[user],
					{
						advisorModel: "claude-fable-5-1",
					},
				),
				unknown: sessionAdvisorModel([], {}),
			},
		).toStrictEqual(
			{
				lastHasIt: "claude-opus-5-5",
				turnedOff: null,
				sidechainIgnored: "claude-fable-5-1",
				syntheticIgnored: "claude-fable-5-1",
				fromSettings: "claude-fable-5-1",
				unknown: undefined,
			},
		);
	});
});
