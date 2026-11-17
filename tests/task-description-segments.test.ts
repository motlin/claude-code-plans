import {describe, expect, it} from "vite-plus/test";
import
{
	plainSegmentsText,
	stepDescriptionSegments,
	taskDescriptionSegments,
} from "../src/lib/task-description-segments";

describe("taskDescriptionSegments", () =>
{
	it("turns the word artifact before an artifact URL into a link and drops the URL, as upstream's dj does", () =>
	{
		expect(
			taskDescriptionSegments("Publish artifact https://claude.ai/code/artifact/abc", "local_agent"),
		).toStrictEqual([
			"Publish ",
			{
				word: "artifact",
				href: "https://claude.ai/code/artifact/abc",
			},
		]);
	});

	it("keeps the text after the link and matches the plural word case-insensitively", () =>
	{
		expect(
			taskDescriptionSegments("Review Artifacts https://claude.ai/artifact/xyz then ship", "local_agent"),
		).toStrictEqual([
			"Review ",
			{
				word: "Artifacts",
				href: "https://claude.ai/artifact/xyz",
			},
			" then ship",
		]);
	});

	it("keeps an artifact URL with no artifact word before it as text", () =>
	{
		expect(
			taskDescriptionSegments(
				"See https://claude.ai/artifact/one and artifact https://claude.ai/artifact/two",
				"local_agent",
			),
		).toStrictEqual([
			"See https://claude.ai/artifact/one and ",
			{
				word: "artifact",
				href: "https://claude.ai/artifact/two",
			},
		]);
	});

	it("leaves local_bash descriptions alone", () =>
	{
		expect(taskDescriptionSegments("Publish artifact https://claude.ai/code/artifact/abc", "local_bash")).toBe(
			undefined,
		);
	});

	it("returns undefined when no artifact link was made", () =>
	{
		expect(
			{
				plain: taskDescriptionSegments("see https://example.com", "local_agent"),
				bare: taskDescriptionSegments("artifact https://claude.ai/artifact/abc", null) === undefined,
				noUrl: taskDescriptionSegments("Publish artifact", "local_agent"),
			},
		).toStrictEqual(
			{
				plain: undefined,
				bare: false,
				noUrl: undefined,
			},
		);
	});

	it("scans and trims URLs like upstream's Cu/Du: one trailing punctuation mark, then unmatched closing parens", () =>
	{
		const link =
		{
			word: "artifact",
			href: "https://claude.ai/code/artifact/abc",
		};
		expect(
			{
				dot: taskDescriptionSegments("Publish artifact https://claude.ai/code/artifact/abc.", "local_agent"),
				paren: taskDescriptionSegments("(see artifact https://claude.ai/code/artifact/abc)", "local_agent"),
				apostrophe: taskDescriptionSegments("artifact https://claude.ai/code/artifact/abc'", "local_agent"),
				quoted: taskDescriptionSegments('artifact "https://claude.ai/code/artifact/abc"', "local_agent"),
			},
		).toStrictEqual(
			{
				dot: ["Publish ", link, "."],
				paren: ["(see ", link, ")"],
				apostrophe: undefined,
				quoted: undefined,
			},
		);
	});

	it("joins text and link words without URLs, as upstream's NA does", () =>
	{
		expect(
			plainSegmentsText([
				"Publish ",
				{
					word: "artifact",
					href: "https://claude.ai/code/artifact/abc",
				},
				" now",
			]),
		).toBe("Publish artifact now");
	});
});

describe("stepDescriptionSegments", () =>
{
	it("links like taskDescriptionSegments but refuses text or hrefs with invisible or control characters, as upstream's Pme does", () =>
	{
		expect(
			{
				clean: stepDescriptionSegments("Publish artifact https://claude.ai/code/artifact/abc", "local_agent"),
				bidi: stepDescriptionSegments(
					"Publish\u202e artifact https://claude.ai/code/artifact/abc",
					"local_agent",
				),
				zeroWidth: stepDescriptionSegments(
					"Publish artifact\u200b https://claude.ai/code/artifact/abc",
					"local_agent",
				),
				trailing: stepDescriptionSegments(
					"Publish artifact https://claude.ai/code/artifact/abc then\u2800",
					"local_agent",
				),
			},
		).toStrictEqual(
			{
				clean: [
					"Publish ",
					{
						word: "artifact",
						href: "https://claude.ai/code/artifact/abc",
					},
				],
				bidi: undefined,
				zeroWidth: undefined,
				trailing: undefined,
			},
		);
	});
});
