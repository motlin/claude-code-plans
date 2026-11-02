import {readFileSync} from "node:fs";
import {optimize} from "@tailwindcss/node";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

describe("CSS Custom Highlight rules through Tailwind's optimize pass", () =>
{
	afterEach(() =>
	{
		vi.restoreAllMocks();
	});

	it("keeps every ::highlight() rule and optimizes them without a build warning", () =>
	{
		const rules = styles.match(/^::highlight\([^)]+\)\s*\{[^}]*\}/gm)?.join("\n") ?? "";
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const {code} = optimize(
			rules,
			{
				minify: true,
			},
		);
		expect(
			{
				code,
				warnings: warn.mock.calls,
			},
		).toStrictEqual(
			{
				code: "::highlight(file-find){background-color:#facc1559}::highlight(file-find-active){background-color:#f97316a6}::highlight(plan-selection){color:highlighttext;background-color:highlight}",
				warnings: [],
			},
		);
	});
});
