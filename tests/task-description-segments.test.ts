import {describe, expect, it} from "vite-plus/test";
import {taskDescriptionSegments} from "../src/lib/task-description-segments";

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
});
