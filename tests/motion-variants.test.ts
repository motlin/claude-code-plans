import {describe, expect, it} from "vite-plus/test";
import {loadDesignSystem} from "./helpers/tailwind-design-system";

async function compile(candidate: string): Promise<string>
{
	const [rule] = (await loadDesignSystem()).candidatesToCss([candidate]);
	return (rule ?? "").replaceAll(/\s+/g, " ").trim();
}

describe("motion-safe: / motion-reduce: honour html[data-reduce-motion=true]", () =>
{
	it("motion-safe: needs the no-preference query and no reduce-motion ancestor, as upstream's variant does", async () =>
	{
		expect(await compile("motion-safe:transition-opacity")).toBe(
			'@media (prefers-reduced-motion: no-preference) { .motion-safe\\:transition-opacity:not(:where([data-reduce-motion="true"], [data-reduce-motion="true"] *)) { transition-property: opacity; transition-timing-function: var(--tw-ease, var(--default-transition-timing-function)); transition-duration: var(--tw-duration, var(--default-transition-duration)); } }',
		);
	});

	it("motion-reduce: applies under the reduce query or a reduce-motion ancestor, as upstream's two rules do", async () =>
	{
		expect(await compile("motion-reduce:transition-none")).toBe(
			'@media (prefers-reduced-motion: reduce) { .motion-reduce\\:transition-none { transition-property: none; } } .motion-reduce\\:transition-none:where([data-reduce-motion="true"], [data-reduce-motion="true"] *) { transition-property: none; }',
		);
	});

	it("keeps stacked variants such as dark:motion-reduce:", async () =>
	{
		const rule = await compile("dark:motion-reduce:animate-none");

		expect(
			{
				dark: rule.includes(":is(.dark *)"),
				media: rule.includes("@media (prefers-reduced-motion: reduce)"),
				attribute: rule.includes(':where([data-reduce-motion="true"], [data-reduce-motion="true"] *)'),
			},
		).toStrictEqual(
			{
				dark: true,
				media: true,
				attribute: true,
			},
		);
	});
});
