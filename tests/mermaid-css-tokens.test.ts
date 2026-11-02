import {describe, expect, it} from "vite-plus/test";
import {loadDesignSystem} from "./helpers/tailwind-design-system";

async function compile(candidates: string[]): Promise<Record<string, string>>
{
	const css = (await loadDesignSystem()).candidatesToCss(candidates);
	return Object.fromEntries(
		candidates.map((candidate, index) => [candidate, (css[index] ?? "").replaceAll(/\s+/g, " ").trim()]),
	);
}

describe("utilities the mermaid fence and renderer use (upstream c9e4d0c57 / shared-41 x2)", () =>
{
	it("draws upstream's legacy border-400 / bg-000 block on the local border and surface-3 tokens", async () =>
	{
		expect(await compile(["border-border", "bg-surface-3/50", "font-mono-ui", "duration-base"])).toStrictEqual(
			{
				"border-border": ".border-border { border-color: var(--upstream-border); }",
				"bg-surface-3/50":
					".bg-surface-3\\/50 { background-color: color-mix(in oklab, var(--upstream-surface-3) 50%, transparent); }",
				"font-mono-ui":
					".font-mono-ui { font-family: var(--font-mono-ui); font-feature-settings: var(--font-mono-ui--font-feature-settings); }",
				"duration-base": ".duration-base { --tw-duration: 200ms; transition-duration: 200ms; }",
			},
		);
	});

	it("compiles the arbitrary and variant classes", async () =>
	{
		expect(
			await compile([
				"rounded-[var(--msg-block-radius,0.5rem)]",
				"starting:opacity-0",
				"[contain:paint]",
				"gap-xs",
			]),
		).toStrictEqual(
			{
				"rounded-[var(--msg-block-radius,0.5rem)]":
					".rounded-\\[var\\(--msg-block-radius\\,0\\.5rem\\)\\] { border-radius: var(--msg-block-radius,0.5rem); }",
				"starting:opacity-0": "@starting-style { .starting\\:opacity-0 { opacity: 0%; } }",
				"[contain:paint]": ".\\[contain\\:paint\\] { contain: paint; }",
				"gap-xs": ".gap-xs { gap: var(--cds-gap-xs); }",
			},
		);
	});
});
