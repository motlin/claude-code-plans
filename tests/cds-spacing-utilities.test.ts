// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";
import {compileAll} from "./helpers/tailwind-design-system";

const styles = readFileSync("src/styles/globals.css", "utf8");

/** The declarations of the first top-level block whose selector is exactly `selector`. */
function block(selector: string): Record<string, string>
{
	const start = styles.indexOf(`\n${selector}\n{\n`);
	if (start === -1) throw new Error(`no ${selector} block`);
	const body = styles.slice(start + selector.length + 4, styles.indexOf("\n}", start));
	return Object.fromEntries(
		[...body.matchAll(/^\s*(--cds-(?:gap|pad)-[a-z]+):\s*([^;]+);/gm)].map(([, name, value]) => [name, value]),
	);
}

const BASE_SCALE =
{
	"--cds-gap-xs": "0.375rem",
	"--cds-gap-sm": "0.5rem",
	"--cds-gap-md": "0.75rem",
	"--cds-gap-lg": "1.25rem",
	"--cds-gap-xl": "2rem",
	"--cds-pad-xs": "0.25rem",
	"--cds-pad-sm": "0.375rem",
	"--cds-pad-md": "0.5rem",
	"--cds-pad-lg": "0.75rem",
	"--cds-pad-xl": "1.25rem",
};

describe("cds density spacing utilities", () =>
{
	it("compiles upstream's gap/pad names onto the cds tokens and leaves the stock spacing names alone", async () =>
	{
		expect(
			await compileAll([
				"gap-xs",
				"gap-x-md",
				"gap-y-sm",
				"px-md",
				"py-md",
				"pb-md",
				"pt-sm",
				"pe-sm",
				"ps-xl",
				"p-lg",
				"ms-md",
				"-ms-md",
				"-me-pad-xs",
				"-mx-pad-md",
				"mt-pad-sm",
				"max-w-xs",
				"max-w-md",
				"gap-2",
				"px-3",
				"-mt-2",
				"mx-auto",
				"gap-g5",
				"pt-p4",
			]),
		).toStrictEqual(
			{
				"gap-xs": ".gap-xs { gap: var(--cds-gap-xs); }",
				"gap-x-md": ".gap-x-md { column-gap: var(--cds-gap-md); }",
				"gap-y-sm": ".gap-y-sm { row-gap: var(--cds-gap-sm); }",
				"px-md": ".px-md { padding-inline: var(--cds-pad-md); }",
				"py-md": ".py-md { padding-block: var(--cds-pad-md); }",
				"pb-md": ".pb-md { padding-bottom: var(--cds-pad-md); }",
				"pt-sm": ".pt-sm { padding-top: var(--cds-pad-sm); }",
				"pe-sm": ".pe-sm { padding-inline-end: var(--cds-pad-sm); }",
				"ps-xl": ".ps-xl { padding-inline-start: var(--cds-pad-xl); }",
				"p-lg": ".p-lg { padding: var(--cds-pad-lg); }",
				"ms-md": ".ms-md { margin-inline-start: var(--cds-gap-md); }",
				"-ms-md": ".-ms-md { margin-inline-start: calc(var(--cds-gap-md) * -1); }",
				"-me-pad-xs": ".-me-pad-xs { margin-inline-end: calc(var(--cds-pad-xs) * -1); }",
				"-mx-pad-md": ".-mx-pad-md { margin-inline: calc(var(--cds-pad-md) * -1); }",
				"mt-pad-sm": ".mt-pad-sm { margin-top: var(--cds-pad-sm); }",
				"max-w-xs": ".max-w-xs { max-width: var(--container-xs); }",
				"max-w-md": ".max-w-md { max-width: var(--container-md); }",
				"gap-2": ".gap-2 { gap: calc(var(--spacing) * 2); }",
				"px-3": ".px-3 { padding-inline: calc(var(--spacing) * 3); }",
				"-mt-2": ".-mt-2 { margin-top: calc(var(--spacing) * -2); }",
				"mx-auto": ".mx-auto { margin-inline: auto; }",
				"gap-g5": ".gap-g5 { gap: 6px; }",
				"pt-p4": ".pt-p4 { padding-top: 5px; }",
			},
		);
	});

	it("compiles the transcript row's copied reserves-actions-gap arms to a pb-md band under a non-empty marked child", async () =>
	{
		expect(
			await compileAll([
				"[&:has(>[data-reserves-actions-gap]:not(:empty))]:pb-md",
				"[&:has(>[data-reply-scope]>[data-reserves-actions-gap]:not(:empty))]:pb-md",
			]),
		).toStrictEqual(
			{
				"[&:has(>[data-reserves-actions-gap]:not(:empty))]:pb-md":
					".\\[\\&\\:has\\(\\>\\[data-reserves-actions-gap\\]\\:not\\(\\:empty\\)\\)\\]\\:pb-md:has( > [data-reserves-actions-gap]:not(:empty)) { padding-bottom: var(--cds-pad-md); }",
				"[&:has(>[data-reply-scope]>[data-reserves-actions-gap]:not(:empty))]:pb-md":
					".\\[\\&\\:has\\(\\>\\[data-reply-scope\\]\\>\\[data-reserves-actions-gap\\]\\:not\\(\\:empty\\)\\)\\]\\:pb-md:has( > [data-reply-scope] > [data-reserves-actions-gap]:not(:empty)) { padding-bottom: var(--cds-pad-md); }",
			},
		);
	});

	it("declares upstream's base scale in @theme, restates it for compact scopes and widens it for comfortable ones", () =>
	{
		const theme = styles.slice(styles.indexOf("\n@theme\n{\n"));
		const themeScale = Object.fromEntries(
			[...theme.slice(0, theme.indexOf("\n}")).matchAll(/^\s*(--cds-(?:gap|pad)-[a-z]+):\s*([^;]+);/gm)].map(
				([, name, value]) => [name, value],
			),
		);

		expect(
			{
				theme: themeScale,
				compact: block('[data-density="compact"]'),
				comfortable: block('[data-density="comfortable"]'),
			},
		).toStrictEqual(
			{
				theme: BASE_SCALE,
				compact: BASE_SCALE,
				comfortable:
				{
					"--cds-gap-xs": "0.5rem",
					"--cds-gap-sm": "0.75rem",
					"--cds-gap-md": "1rem",
					"--cds-gap-lg": "1.75rem",
					"--cds-gap-xl": "2.5rem",
					"--cds-pad-xs": "0.375rem",
					"--cds-pad-sm": "0.5rem",
					"--cds-pad-md": "0.75rem",
					"--cds-pad-lg": "1rem",
					"--cds-pad-xl": "1.5rem",
				},
			},
		);
	});

	it("puts the spacing tokens in the same density blocks as the type tokens, so they follow the nearest scope", () =>
	{
		const owners = (token: string) =>
			[...styles.matchAll(new RegExp(`^(\\S[^{\\n]*)\\n\\{\\n(?:[^}]*\\n)?\\s*${token}:`, "gm"))]
				.map(([, selector]) => selector ?? "")
				.filter((selector) => selector.startsWith("[data-density"));
		document.body.innerHTML =
			'<div data-density="compact"><div data-density="comfortable"><div data-density="compact"><p id="probe"></p></div></div></div>';
		const probe = document.querySelector("#probe");
		const nearest = probe
			?.closest('[data-density="compact"], [data-density="comfortable"]')
			?.getAttribute("data-density");

		expect(
			{
				type: owners("--upstream-text-body"),
				gap: owners("--cds-gap-md"),
				pad: owners("--cds-pad-md"),
				nearest,
			},
		).toStrictEqual(
			{
				type: ['[data-density="comfortable"]', '[data-density="compact"]'],
				gap: ['[data-density="comfortable"]', '[data-density="compact"]'],
				pad: ['[data-density="comfortable"]', '[data-density="compact"]'],
				nearest: "compact",
			},
		);
	});

	it("remaps the pad scale inside data-size xs/sm/lg subtrees onto upstream's per-size pads, per density", () =>
	{
		const sizePads = (selector: string) =>
		{
			const start = styles.indexOf(`\n${selector}\n{\n`);
			if (start === -1) throw new Error(`no ${selector} block`);
			const body = styles.slice(start, styles.indexOf("\n}", start));
			return Object.fromEntries(
				[...body.matchAll(/^\s*(--cds-pad-[a-z]+--[a-z]+):\s*([^;]+);/gm)].map(([, name, value]) => [
					name,
					value,
				]),
			);
		};
		const remap = (size: string) =>
		{
			const selector = `[data-size="${size}"]`;
			const start = styles.indexOf(`\n${selector}\n{\n`);
			if (start === -1) return null;
			const body = styles.slice(start, styles.indexOf("\n}", start));
			return Object.fromEntries(
				[...body.matchAll(/^\s*(--cds-pad-[a-z]+):\s*([^;]+);/gm)].map(([, name, value]) => [name, value]),
			);
		};
		const steps = ["xs", "sm", "md", "lg", "xl"];
		const sizeScale = (values: Record<string, readonly string[]>) =>
			Object.fromEntries(
				steps.flatMap((step, index) =>
					["xs", "sm", "lg"].map((size) => [`--cds-pad-${step}--${size}`, values[size]?.[index] ?? ""]),
				),
			);
		const compactScale = sizeScale(
			{
				xs: ["0.125rem", "0.25rem", "0.375rem", "0.625rem", "0.875rem"],
				sm: ["0.125rem", "0.25rem", "0.375rem", "0.625rem", "0.875rem"],
				lg: ["0.375rem", "0.5rem", "0.625rem", "0.875rem", "1.375rem"],
			},
		);

		expect(
			{
				root: sizePads(":root"),
				compact: sizePads('[data-density="compact"]'),
				comfortable: sizePads('[data-density="comfortable"]'),
				xs: remap("xs"),
				sm: remap("sm"),
				lg: remap("lg"),
			},
		).toStrictEqual(
			{
				root: compactScale,
				compact: compactScale,
				comfortable: sizeScale(
					{
						xs: ["0.25rem", "0.375rem", "0.5rem", "0.75rem", "1.25rem"],
						sm: ["0.375rem", "0.5rem", "0.625rem", "0.875rem", "1.375rem"],
						lg: ["0.5rem", "0.75rem", "1rem", "1.25rem", "1.75rem"],
					},
				),
				...Object.fromEntries(
					["xs", "sm", "lg"].map((size) => [
						size,
						Object.fromEntries(
							steps.map((step) => [`--cds-pad-${step}`, `var(--cds-pad-${step}--${size})`]),
						),
					]),
				),
			},
		);
	});
});
