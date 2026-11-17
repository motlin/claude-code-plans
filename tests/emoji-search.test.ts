import {describe, expect, it} from "vite-plus/test";
import {EMOJI_TABLE, EMOJI_TABLE_CATEGORIES} from "../src/lib/emoji-table";
import {EXTRA_SHORTCODES, loadEmoji, searchEmoji, stripVs16} from "../src/lib/emoji-search";

async function names(query: string): Promise<string[]>
{
	return (await searchEmoji(query)).map((item) => item.name);
}

describe("emoji search (upstream Wm)", () =>
{
	it("ports the 1870-row table and its categories", () =>
	{
		expect(EMOJI_TABLE.length).toBe(1870);
		expect(EMOJI_TABLE[0]).toEqual(["\u{1F600}", ["grinning"], ["smile", "happy"], "grinning face", 0]);
		expect(EMOJI_TABLE_CATEGORIES).toEqual([
			"Smileys & Emotion",
			"People & Body",
			"Animals & Nature",
			"Food & Drink",
			"Travel & Places",
			"Activities",
			"Objects",
			"Symbols",
			"Flags",
		]);
	});

	it("ranks starts-with, then includes, then keyword matches, eight at most", async () =>
	{
		expect(
			{
				sm: await names("sm"),
				ro: await names("ro"),
				rob: await names("rob"),
				zz: await names("zz"),
				SM: await names("SM"),
			},
		).toEqual(
			{
				sm: [
					"smiley",
					"smile",
					"smiling_face_with_three_hearts",
					"smiling_face_with_tear",
					"smirk",
					"smiling_imp",
					"smiley_cat",
					"smile_cat",
				],
				ro: ["rofl", "roll_eyes", "robot", "rowboat", "rowing_man", "rowing_woman", "rooster", "rosette"],
				rob: [
					"robot",
					"person_with_probing_cane",
					"man_with_probing_cane",
					"woman_with_probing_cane",
					"microbe",
					"probing_cane",
					"interrobang",
				],
				zz: ["zzz", "dizzy_face", "dizzy", "pizza", "congo_brazzaville", "sleeping"],
				SM: [
					"smiley",
					"smile",
					"smiling_face_with_three_hearts",
					"smiling_face_with_tear",
					"smirk",
					"smiling_imp",
					"smiley_cat",
					"smile_cat",
				],
			},
		);
	});

	it("adds upstream's extra shortcodes that the table lacks", async () =>
	{
		expect(await searchEmoji("+1")).toEqual([
			{
				name: "+1",
				char: "\u{1F44D}",
				keywords: ["thumbsup", "approve", "ok"],
			},
		]);
		expect(await searchEmoji("shipi")).toEqual([
			{
				name: "shipit",
				char: "\u{1F6A2}",
				keywords: [],
			},
		]);
		expect(Object.keys(EXTRA_SHORTCODES).length).toBe(75);
	});

	it("returns nothing for an empty query", async () =>
	{
		expect(await searchEmoji("")).toEqual([]);
	});

	it("builds items from the table and strips variation selectors", async () =>
	{
		const items = await loadEmoji();
		expect(items.find((item) => item.name === "laughing")).toEqual(
			{
				name: "laughing",
				char: "\u{1F606}",
				keywords: ["satisfied", "happy", "haha"],
			},
		);
		expect(stripVs16("❤️")).toBe("❤");
	});
});
