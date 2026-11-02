import {describe, expect, it} from "vite-plus/test";
import {formatTokenCount} from "../src/lib/composer-state";
import
{
	STALE_COMPACT,
	STALE_COMPACT_FLOOR,
	decideStaleCompact,
	formatStaleAge,
	lastEntryIsAssistantReply,
	staleCompactLine,
	staleCompactQualifies,
	staleCompactSlot,
	staleCompactWhy,
} from "../src/lib/stale-compact";
import {processTranscript} from "../src/lib/transcript";

describe("stale-compact gate (upstream _a / ba)", () =>
{
	it("copies upstream's thresholds", () =>
	{
		expect(STALE_COMPACT).toStrictEqual(
			{
				minAgeMinutes: 70,
				minContextPct: 75,
				minContextTokens: 300_000,
			},
		);
		expect(STALE_COMPACT_FLOOR).toBe(300_000);
	});

	it("qualifies at 75% of the window", () =>
	{
		expect(
			staleCompactQualifies(
				150_000,
				200_000,
				{
					minPct: 75,
					minTokens: null,
				},
			),
		).toBe(true);
		expect(
			staleCompactQualifies(
				149_999,
				200_000,
				{
					minPct: 75,
					minTokens: null,
				},
			),
		).toBe(false);
	});

	it("qualifies at the absolute floor below 75%", () =>
	{
		expect(
			staleCompactQualifies(
				300_000,
				1_000_000,
				{
					minPct: 75,
					minTokens: 300_000,
				},
			),
		).toBe(true);
		expect(
			staleCompactQualifies(
				299_999,
				1_000_000,
				{
					minPct: 75,
					minTokens: 300_000,
				},
			),
		).toBe(false);
	});
});

// The bundle's xTe switches to days at 1440 minutes, so 1579 reads "1d" (the feature file's "26h" example was wrong).
describe("formatStaleAge (upstream xTe, narrow units)", () =>
{
	it.each([
		[70, "1h"],
		[1579, "1d"],
		[1380, "23h"],
		[1439, "23h"],
		[1440, "1d"],
		[2880, "2d"],
	])("%i minutes reads %s", (minutes, expected) =>
	{
		expect(formatStaleAge(minutes)).toBe(expected);
	});
});

describe("stale-compact copy", () =>
{
	it("puts the tokens in the line when the floor is on", () =>
	{
		expect(
			staleCompactLine(
				{
					tokensInLine: true,
					contextTokens: 412_000,
				},
			),
		).toBe(
			"Your next message re-reads all 412k tokens. Compact first so later messages start from a short summary.",
		);
	});

	it("uses the control arm's generic line when the floor is off", () =>
	{
		expect(
			staleCompactLine(
				{
					tokensInLine: false,
					contextTokens: 412_000,
				},
			),
		).toBe("Compacting before your next message keeps later replies fast and lighter on your usage.");
	});

	it("explains the advice in the popover", () =>
	{
		expect(
			staleCompactWhy(
				{
					ageMinutes: 1379,
					contextTokens: 412_000,
				},
			),
		).toBe(
			"After 22h idle, the cache has expired, so your next message re-reads all 412k tokens. Compact first so later replies run on a short summary instead.",
		);
	});
});

describe("decideStaleCompact", () =>
{
	const base =
	{
		nowMs: 94_740_000,
		anchorMs: 0,
		contextTokens: 412_000,
		contextWindow: 1_000_000,
		floor: 300_000,
		eligible: true,
	} as const;

	it("advises an old, large, eligible session", () =>
	{
		expect(decideStaleCompact(base)).toStrictEqual(
			{
				anchor: 0,
				ageMinutes: 1579,
				contextTokens: 412_000,
				tokensInLine: true,
			},
		);
	});

	it.each([
		[
			"idle under 70 minutes",
			{
				nowMs: 4_199_999,
			},
		],
		[
			"ineligible",
			{
				eligible: false,
			},
		],
		[
			"unknown tokens",
			{
				contextTokens: null,
			},
		],
		[
			"unknown window",
			{
				contextWindow: null,
			},
		],
		[
			"empty window",
			{
				contextWindow: 0,
			},
		],
		[
			"under both thresholds",
			{
				contextTokens: 200_000,
			},
		],
	])("returns null when %s", (_name, override) =>
	{
		expect(
			decideStaleCompact(
				{
					...base,
					...override,
				},
			),
		).toBeNull();
	});

	it("advises at exactly 70 minutes", () =>
	{
		expect(
			decideStaleCompact(
				{
					...base,
					nowMs: 4_200_000,
				},
			),
		).toStrictEqual(
			{
				anchor: 0,
				ageMinutes: 70,
				contextTokens: 412_000,
				tokensInLine: true,
			},
		);
	});

	it("drops the tokens from the line with no floor", () =>
	{
		expect(
			decideStaleCompact(
				{
					...base,
					floor: null,
					contextTokens: 160_000,
					contextWindow: 200_000,
				},
			),
		).toStrictEqual(
			{
				anchor: 0,
				ageMinutes: 1579,
				contextTokens: 160_000,
				tokensInLine: false,
			},
		);
	});
});

describe("staleCompactSlot (upstream Xu)", () =>
{
	it("is open only when the last entry is the assistant's", () =>
	{
		expect(
			staleCompactSlot(
				{
					lastEntryIsAssistant: true,
				},
			),
		).toBe(true);
		expect(
			staleCompactSlot(
				{
					lastEntryIsAssistant: false,
				},
			),
		).toBe(false);
	});

	const user =
	{
		type: "user",
		uuid: "u-1",
		message:
		{
			role: "user",
			content: "Fabricated prompt",
		},
	};
	const assistant =
	{
		type: "assistant",
		uuid: "a-1",
		message:
		{
			role: "assistant",
			content: [
				{
					type: "text",
					text: "Fabricated reply",
				},
			],
		},
	};

	it("finds an assistant reply as the last entry", () =>
	{
		expect(lastEntryIsAssistantReply(processTranscript([user, assistant]).lines)).toBe(true);
	});

	it("rejects a user prompt as the last entry", () =>
	{
		expect(lastEntryIsAssistantReply(processTranscript([assistant, user]).lines)).toBe(false);
	});

	it("rejects a synthetic API error as the last entry", () =>
	{
		const error =
		{
			type: "assistant",
			uuid: "a-2",
			isApiErrorMessage: true,
			message:
			{
				role: "assistant",
				model: "<synthetic>",
				content: [
					{
						type: "text",
						text: "API Error: 500",
					},
				],
			},
		};
		expect(lastEntryIsAssistantReply(processTranscript([user, error]).lines)).toBe(false);
	});

	it("rejects an empty transcript", () =>
	{
		expect(lastEntryIsAssistantReply([])).toBe(false);
	});
});

describe("formatTokenCount rollover (upstream vj)", () =>
{
	it("promotes 999,950 to 1M", () =>
	{
		expect(formatTokenCount(999_950)).toBe("1M");
	});

	it("keeps ordinary values", () =>
	{
		expect([formatTokenCount(412_000), formatTokenCount(1_234_567), formatTokenCount(999)]).toStrictEqual([
			"412k",
			"1.2M",
			"999",
		]);
	});
});
