import type {ThemedToken} from "@shikijs/core";
import {describe, expect, it} from "vite-plus/test";

import {shikiMarks} from "../src/lib/shiki-cm-marks";

function token(content: string, color: string, fontStyle = 0): ThemedToken
{
	return {
		content,
		color,
		fontStyle,
		offset: 0,
	};
}

describe("shikiMarks", () =>
{
	it("numbers token colors in first-seen order", () =>
	{
		expect(shikiMarks([[token("const", "#a"), token(" x", "#b")]], [0])).toStrictEqual(
			{
				decorations: [
					{
						from: 0,
						to: 5,
						class: "cm-shikiColor1",
					},
					{
						from: 5,
						to: 7,
						class: "cm-shikiColor2",
					},
				],
				palette: ["#a", "#b"],
			},
		);
	});

	it("offsets later lines by their line starts and reuses a seen color", () =>
	{
		expect(shikiMarks([[token("a", "#a")], [token("bb", "#b"), token("c", "#a")]], [0, 2])).toStrictEqual(
			{
				decorations: [
					{
						from: 0,
						to: 1,
						class: "cm-shikiColor1",
					},
					{
						from: 2,
						to: 4,
						class: "cm-shikiColor2",
					},
					{
						from: 4,
						to: 5,
						class: "cm-shikiColor1",
					},
				],
				palette: ["#a", "#b"],
			},
		);
	});

	it("adds font style classes", () =>
	{
		expect(shikiMarks([[token("x", "#a", 2), token("y", "#a", 1 | 4 | 8)]], [0]).decorations).toStrictEqual([
			{
				from: 0,
				to: 1,
				class: "cm-shikiColor1 cm-shikiBold",
			},
			{
				from: 1,
				to: 2,
				class: "cm-shikiColor1 cm-shikiItalic cm-shikiUnderline cm-shikiStrikethrough",
			},
		]);
	});
});
