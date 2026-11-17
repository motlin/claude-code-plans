import {describe, expect, it} from "vite-plus/test";
import {emojiMenuPosition, emojiTrigger} from "../src/lib/emoji-trigger";

describe("emojiTrigger", () =>
{
	it("finds a : token at a line start or after whitespace, with the caret at a word end", () =>
	{
		expect([
			emojiTrigger("hello :sm", 9),
			emojiTrigger(":sm", 3),
			emojiTrigger("x\n:th", 5),
			emojiTrigger("a\t:", 3),
			emojiTrigger(":sm rest", 3),
		]).toEqual([
			{
				start: 6,
				query: "sm",
			},
			{
				start: 0,
				query: "sm",
			},
			{
				start: 2,
				query: "th",
			},
			{
				start: 2,
				query: "",
			},
			{
				start: 0,
				query: "sm",
			},
		]);
	});

	it("ignores a glued :, a caret before text, and a token holding another :", () =>
	{
		expect([
			emojiTrigger("a:sm", 4),
			emojiTrigger(":smX", 3),
			emojiTrigger(":sm:x", 5),
			emojiTrigger("hello", 5),
		]).toEqual([null, null, null, null]);
	});
});

describe("emojiMenuPosition (upstream G)", () =>
{
	const viewport =
	{
		width: 1200,
		height: 900,
	};

	it("opens above when there is at least as much room above, otherwise below, 24px off the caret", () =>
	{
		expect([
			emojiMenuPosition(
				{
					caret:
					{
						top: 700,
						left: 300,
						right: 320,
					},
					viewport,
					rtl: false,
				},
			),
			emojiMenuPosition(
				{
					caret:
					{
						top: 100,
						left: 300,
						right: 320,
					},
					viewport,
					rtl: false,
				},
			),
			emojiMenuPosition(
				{
					caret:
					{
						top: 250,
						left: 300,
						right: 320,
					},
					viewport,
					rtl: false,
				},
			),
		]).toEqual([
			{
				top: 676,
				left: 300,
				maxHeight: 280,
				transform: "translateY(-100%)",
			},
			{
				top: 124,
				left: 300,
				maxHeight: 280,
				transform: "",
			},
			{
				top: 274,
				left: 300,
				maxHeight: 280,
				transform: "",
			},
		]);
	});

	it("caps the height at the room on the chosen side", () =>
	{
		expect(
			emojiMenuPosition(
				{
					caret:
					{
						top: 200,
						left: 0,
						right: 0,
					},
					viewport:
					{
						width: 390,
						height: 360,
					},
					rtl: false,
				},
			),
		).toEqual(
			{
				top: 176,
				left: 0,
				maxHeight: 160,
				transform: "translateY(-100%)",
			},
		);
	});

	it("shifts left to stay 16px inside a narrow viewport, and right-aligns in RTL", () =>
	{
		expect([
			emojiMenuPosition(
				{
					caret:
					{
						top: 100,
						left: 300,
						right: 310,
					},
					viewport:
					{
						width: 390,
						height: 800,
					},
					rtl: false,
				},
			).left,
			emojiMenuPosition(
				{
					caret:
					{
						top: 100,
						left: 300,
						right: 310,
					},
					viewport:
					{
						width: 390,
						height: 800,
					},
					rtl: true,
				},
			).left,
			emojiMenuPosition(
				{
					caret:
					{
						top: 100,
						left: 100,
						right: 110,
					},
					viewport:
					{
						width: 390,
						height: 800,
					},
					rtl: true,
				},
			).left,
		]).toEqual([94, 30, 16]);
	});
});
