import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";
import {compileAll} from "./helpers/tailwind-design-system";

const styles = readFileSync("src/styles/globals.css", "utf8");

describe("custom variants", () =>
{
	it("declares upstream's touch: variant as the coarse-pointer or no-hover media query, next to dark, the motion, the viewport-height and the density variants, cds-Icon and stacks", () =>
	{
		expect(styles.match(/^@custom-variant .*$/gm)).toStrictEqual([
			"@custom-variant dark (&:is(.dark *));",
			"@custom-variant touch",
			"@custom-variant panels-fine",
			"@custom-variant motion-safe",
			"@custom-variant motion-reduce",
			"@custom-variant vh-max-400 (:where(body[data-vh-max-400]) &);",
			"@custom-variant vh-max-420 (:where(body[data-vh-max-420]) &);",
			"@custom-variant vh-max-520 (:where(body[data-vh-max-520]) &);",
			'@custom-variant compact (&:where([data-density="compact"] *):not(:where([data-density="compact"] [data-density="comfortable"] *):not(:where([data-density="compact"] [data-density="comfortable"] [data-density="compact"] *):not(:where([data-density="compact"] [data-density="comfortable"] [data-density="compact"] [data-density="comfortable"] *)))));',
			'@custom-variant comfortable (&:where([data-density="comfortable"] *):not(:where([data-density="comfortable"] [data-density="compact"] *):not(:where([data-density="comfortable"] [data-density="compact"] [data-density="comfortable"] *):not(:where([data-density="comfortable"] [data-density="compact"] [data-density="comfortable"] [data-density="compact"] *)))));',
			"@custom-variant cds-Icon (& [data-cds=Icon]);",
			"@custom-variant stacks",
			'@custom-variant page-rtl (&:where(:root[dir="rtl"] :dir(rtl)));',
		]);
	});

	it("compiles every touch: utility to one coarse-pointer or no-hover @media rule, not a selector with a dangling (hover: none) combinator", async () =>
	{
		expect(await compileAll(["touch:flex", "touch:hidden", "touch:min-h-11", "touch:opacity-100"])).toStrictEqual(
			{
				"touch:flex": "@media (pointer: coarse), (hover: none) { .touch\\:flex { display: flex; } }",
				"touch:hidden": "@media (pointer: coarse), (hover: none) { .touch\\:hidden { display: none; } }",
				"touch:min-h-11":
					"@media (pointer: coarse), (hover: none) { .touch\\:min-h-11 { min-height: calc(var(--spacing) * 11); } }",
				"touch:opacity-100":
					"@media (pointer: coarse), (hover: none) { .touch\\:opacity-100 { opacity: 100%; } }",
			},
		);
	});
});
