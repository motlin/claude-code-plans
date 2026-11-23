import {describe, expect, it} from "vite-plus/test";

import {HARD_BLOCK_CARDS, hardBlockAt, latestHardBlock} from "../src/lib/hard-block";

type Rec = Record<string, unknown>;

function prompt(uuid: string, text = "hello"): Rec
{
	return {
		type: "user",
		uuid,
		message:
		{
			role: "user",
			content: text,
		},
	};
}

function toolResult(uuid: string): Rec
{
	return {
		type: "user",
		uuid,
		message:
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "t1",
					content: "ok",
				},
			],
		},
	};
}

function reply(uuid: string, stopReason: string | null = "end_turn", extra: Rec = {}): Rec
{
	return {
		type: "assistant",
		uuid,
		...extra,
		message:
		{
			role: "assistant",
			model: "claude-opus-4-5-20251101",
			stop_reason: stopReason,
			content: [
				{
					type: "text",
					text: "ok",
				},
			],
		},
	};
}

const NOT_IN_FLIGHT =
{
	turnInFlight: false,
};

describe("HARD_BLOCK_CARDS", () =>
{
	it("ships on locally", () =>
	{
		expect(HARD_BLOCK_CARDS).toBe(true);
	});
});

describe("latestHardBlock", () =>
{
	it("returns the refusal after the last prompt, whose prompt is still the last rewindable one", () =>
	{
		const records = [prompt("p0"), reply("a0"), prompt("p1", "write it"), reply("r1", "refusal")];
		expect(latestHardBlock(records, NOT_IN_FLIGHT)).toStrictEqual(
			{
				uuid: "r1",
				model: "claude-opus-4-5-20251101",
				hasMessage: true,
			},
		);
	});

	it("names the turn's earlier real model when the refusal row itself is synthetic", () =>
	{
		const synthetic = reply("r1", "refusal");
		synthetic["message"] =
		{
			...(synthetic["message"] as Rec),
			model: "<synthetic>",
		};
		const earlier = reply("a1", "tool_use");
		earlier["message"] =
		{
			...(earlier["message"] as Rec),
			model: "claude-sonnet-5-5",
		};
		const records = [prompt("p0"), reply("a0"), prompt("p1", "write it"), earlier, toolResult("t1"), synthetic];
		expect(latestHardBlock(records, NOT_IN_FLIGHT)).toStrictEqual(
			{
				uuid: "r1",
				model: "claude-sonnet-5-5",
				hasMessage: true,
			},
		);
	});

	it("skips system rows and tool results between the prompt and the refusal", () =>
	{
		const records = [
			prompt("p1"),
			reply("a1", "tool_use"),
			toolResult("t1"),
			reply("r1", "refusal"),
			{
				type: "system",
				subtype: "turn_duration",
				uuid: "s1",
			},
		];
		expect(latestHardBlock(records, NOT_IN_FLIGHT)).toStrictEqual(
			{
				uuid: "r1",
				model: "claude-opus-4-5-20251101",
				hasMessage: true,
			},
		);
	});

	it("is null once a newer prompt follows the refusal", () =>
	{
		expect(latestHardBlock([prompt("p1"), reply("r1", "refusal"), prompt("p2")], NOT_IN_FLIGHT)).toBeNull();
	});

	it("is null when the newest assistant turn didn't refuse", () =>
	{
		expect(latestHardBlock([prompt("p1"), reply("a1")], NOT_IN_FLIGHT)).toBeNull();
	});

	it("is null while a turn is in flight", () =>
	{
		expect(
			latestHardBlock(
				[prompt("p1"), reply("r1", "refusal")],
				{
					turnInFlight: true,
				},
			),
		).toBeNull();
	});

	it("ignores a sidechain refusal", () =>
	{
		const records = [
			prompt("p1"),
			reply("a1"),
			reply(
				"r1",
				"refusal",
				{
					isSidechain: true,
				},
			),
		];
		expect(latestHardBlock(records, NOT_IN_FLIGHT)).toBeNull();
	});
});

describe("hardBlockAt", () =>
{
	it("returns an older refusal by its uuid", () =>
	{
		const records = [prompt("p1"), reply("r1", "refusal"), prompt("p2"), reply("a2")];
		expect(hardBlockAt(records, "r1")).toStrictEqual(
			{
				uuid: "r1",
				model: "claude-opus-4-5-20251101",
				hasMessage: false,
			},
		);
	});

	it("is null for a uuid that isn't the refusal ending its turn", () =>
	{
		const records = [prompt("p1"), reply("r1", "refusal"), reply("a1"), prompt("p2")];
		expect(
			{
				ended: hardBlockAt(records, "r1"),
				missing: hardBlockAt(records, "nope"),
			},
		).toStrictEqual(
			{
				ended: null,
				missing: null,
			},
		);
	});
});
