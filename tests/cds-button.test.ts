import {readFileSync} from "node:fs";

import {Scanner} from "@tailwindcss/oxide";
import {describe, expect, it} from "vite-plus/test";

import {CDS_GHOST_HOVER, cdsButtonClass} from "../src/components/ui/cds-button";
import {compileAll, loadDesignSystem} from "./helpers/tailwind-design-system";

const STACKS =
	':where([data-cds-fizzy-lake~="color"], [data-cds-fizzy-lake~="color"] *):not(:where([data-cds-theme], [data-cds-theme] *))';

/** The candidates sorted into Tailwind's emitted rule order. */
async function ruleOrder(candidates: readonly string[]): Promise<string[]>
{
	const order = (await loadDesignSystem()).getClassOrder([...candidates]);
	return order
		.toSorted(([, a], [, b]) => (a === null || b === null ? 0 : a < b ? -1 : a > b ? 1 : 0))
		.map(([name]) => name);
}

describe("cdsButtonClass fizzy paints (upstream sT, Ct)", () =>
{
	it("spells every class literally, so Tailwind's source scanner finds it without help from the tests", () =>
	{
		const scanner = new Scanner({});
		const scanned = new Set(
			["cds-button.ts", "cds-button-disabled.ts"].flatMap((name) =>
				scanner.scanFiles([
					{
						content: readFileSync(`src/components/ui/${name}`, "utf8"),
						extension: "ts",
					},
				]),
			),
		);
		const unscanned = (["secondary", "ghost", "primary"] as const).flatMap((variant) =>
			cdsButtonClass(variant)
				.split(" ")
				.filter((name) => !scanned.has(name)),
		);
		expect(unscanned).toStrictEqual([]);
	});

	it("hovers a fizzy ghost at the button ghost hover, emitted after the pre-fizzy ghost hover", async () =>
	{
		expect(CDS_GHOST_HOVER).toBe("hover:bg-fill-ghost-hover stacks:hover:bg-fill-button-ghost-hover");
		expect(cdsButtonClass("ghost").split(" ")).toEqual(expect.arrayContaining(CDS_GHOST_HOVER.split(" ")));
		expect(await compileAll(CDS_GHOST_HOVER.split(" "))).toStrictEqual(
			{
				"hover:bg-fill-ghost-hover": String.raw`@media (hover: hover) { .hover\:bg-fill-ghost-hover:hover { background-color: var(--upstream-fill-ghost-hover); } }`,
				"stacks:hover:bg-fill-button-ghost-hover": String.raw`@media (forced-colors: none) { @media (hover: hover) { .stacks\:hover\:bg-fill-button-ghost-hover${STACKS}:hover { background-color: var(--upstream-fill-button-ghost-hover); } } }`,
			},
		);
		expect(await ruleOrder(CDS_GHOST_HOVER.split(" ").toReversed())).toStrictEqual(CDS_GHOST_HOVER.split(" "));
	});

	it("compiles the open, press and primary-layer paints onto the button itself", async () =>
	{
		expect(
			await compileAll([
				"stacks:[&[aria-haspopup][aria-expanded=true]]:layers-2-fill-button-layer",
				"stacks:hover:[&[aria-haspopup][aria-expanded=true]]:layers-3-fill-button-layer",
				"stacks:active:layers-1-fill-primary-layer",
				"[&[aria-haspopup][aria-expanded=true]]:bg-fill-primary-hover",
			]),
		).toStrictEqual(
			{
				"[&[aria-haspopup][aria-expanded=true]]:bg-fill-primary-hover": String.raw`.\[\&\[aria-haspopup\]\[aria-expanded\=true\]\]\:bg-fill-primary-hover[aria-haspopup][aria-expanded=true] { background-color: var(--upstream-fill-primary-hover); }`,
				"stacks:[&[aria-haspopup][aria-expanded=true]]:layers-2-fill-button-layer": String.raw`@media (forced-colors: none) { .stacks\:\[\&\[aria-haspopup\]\[aria-expanded\=true\]\]\:layers-2-fill-button-layer${STACKS}[aria-haspopup][aria-expanded=true] { background-image: linear-gradient(var(--color-fill-button-layer) 0 0), linear-gradient(var(--color-fill-button-layer) 0 0); } }`,
				"stacks:hover:[&[aria-haspopup][aria-expanded=true]]:layers-3-fill-button-layer": String.raw`@media (forced-colors: none) { @media (hover: hover) { .stacks\:hover\:\[\&\[aria-haspopup\]\[aria-expanded\=true\]\]\:layers-3-fill-button-layer${STACKS}:hover[aria-haspopup][aria-expanded=true] { background-image: linear-gradient(var(--color-fill-button-layer) 0 0), linear-gradient(var(--color-fill-button-layer) 0 0), linear-gradient(var(--color-fill-button-layer) 0 0); } } }`,
				"stacks:active:layers-1-fill-primary-layer": String.raw`@media (forced-colors: none) { .stacks\:active\:layers-1-fill-primary-layer${STACKS}:active { background-image: linear-gradient(var(--color-fill-primary-layer) 0 0); } }`,
			},
		);
	});

	it("keeps the disabled secondary fill winning over the open paint it ties in specificity", async () =>
	{
		const classes = cdsButtonClass("secondary").split(" ");
		const paints = classes.filter((name) => /^stacks:.*:bg-(fill|none)/.test(name));
		expect(await ruleOrder(paints.toReversed())).toStrictEqual([
			"stacks:hover:bg-fill-secondary",
			"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled",
			"stacks:[&[aria-haspopup][aria-expanded=true]]:bg-fill-secondary",
			"stacks:[&:disabled:not([aria-busy])]:[&[aria-haspopup][aria-expanded=true]]:bg-fill-disabled",
			"stacks:[&:disabled:not([aria-busy])]:[&[aria-haspopup][aria-expanded=true]]:bg-none",
		]);
	});

	it("paints the primary like upstream d9 (fill-primary, fill-primary-hover on hover and open), with the disabled fills winning", async () =>
	{
		const classes = cdsButtonClass("primary").split(" ");
		const paints = classes.filter((name) => /bg-(fill-primary|primary|none|fill-disabled)/.test(name));
		expect(paints).toStrictEqual([
			"bg-fill-primary",
			"hover:bg-fill-primary-hover",
			"[&[aria-haspopup][aria-expanded=true]]:bg-fill-primary-hover",
			"stacks:active:bg-fill-primary-hover",
			"stacks:[&[aria-haspopup][aria-expanded=true]]:bg-none",
			"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled",
			"stacks:[&:disabled:not([aria-busy])]:[&[aria-haspopup][aria-expanded=true]]:bg-fill-disabled",
			"stacks:[&:disabled:not([aria-busy])]:[&[aria-haspopup][aria-expanded=true]]:bg-none",
		]);
		expect(await ruleOrder(paints.toReversed())).toStrictEqual([
			"bg-fill-primary",
			"hover:bg-fill-primary-hover",
			"stacks:active:bg-fill-primary-hover",
			"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled",
			"[&[aria-haspopup][aria-expanded=true]]:bg-fill-primary-hover",
			"stacks:[&[aria-haspopup][aria-expanded=true]]:bg-none",
			"stacks:[&:disabled:not([aria-busy])]:[&[aria-haspopup][aria-expanded=true]]:bg-fill-disabled",
			"stacks:[&:disabled:not([aria-busy])]:[&[aria-haspopup][aria-expanded=true]]:bg-none",
		]);
	});
});
