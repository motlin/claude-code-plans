import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {cssDeclarations, parseCssRules, pickDeclarations} from "./helpers/css-rules";

// Upstream: c6a992d55 utilities sheet + shared-styles, decoded in
// .llm/upstream-sync/dumps/fizzy-type-dark-wght-axes-css-rules-2026-11-06.txt.
const globals = parseCssRules(readFileSync("src/styles/globals.css", "utf8"));
const markdown = parseCssRules(readFileSync("src/components/markdown-article.module.css", "utf8"));

const AXIS_TOKENS = /^--cds-(font-wght|font-axis-wght|prose-axis-wght)-/;
const FVS = 'var(--font-opsz-axis,) var(--cds-font-axis-wght,) "GRAD" var(--cds-font-grad, 0)';
const axis = (value: string) => (
{
	"--cds-font-axis-wght": value,
	"font-variation-settings": FVS,
});

describe("dark-mode wght axis tokens (T1)", () =>
{
	it(":root declares upstream's light defaults: wght normal, empty axes, role tokens initial", () =>
	{
		expect(pickDeclarations(cssDeclarations(globals, ":root"), AXIS_TOKENS)).toStrictEqual(
			{
				"--cds-font-wght-regular": "normal",
				"--cds-font-wght-medium": "normal",
				"--cds-font-wght-semibold": "normal",
				"--cds-font-wght-bold": "normal",
				"--cds-font-wght-body": "initial",
				"--cds-font-wght-control": "initial",
				"--cds-font-wght-header": "initial",
				"--cds-font-wght-badge": "initial",
				"--cds-font-axis-wght-regular": "",
				"--cds-font-axis-wght-medium": "",
				"--cds-font-axis-wght-semibold": "",
				"--cds-font-axis-wght-bold": "",
				"--cds-font-axis-wght-body": "initial",
				"--cds-font-axis-wght-control": "initial",
				"--cds-font-axis-wght-header": "initial",
				"--cds-font-axis-wght-badge": "initial",
			},
		);
	});

	it(".dark thins regular/medium/semibold/bold to 360/460/540/560 and turns every wght token into a list axis", () =>
	{
		expect(pickDeclarations(cssDeclarations(globals, ".dark"), AXIS_TOKENS)).toStrictEqual(
			{
				"--cds-font-wght-regular": '"wght" 360',
				"--cds-font-wght-medium": '"wght" 460',
				"--cds-font-wght-semibold": '"wght" 540',
				"--cds-font-wght-bold": '"wght" 560',
				"--cds-font-axis-wght-regular": "var(--cds-font-wght-regular),",
				"--cds-font-axis-wght-medium": "var(--cds-font-wght-medium),",
				"--cds-font-axis-wght-semibold": "var(--cds-font-wght-semibold),",
				"--cds-font-axis-wght-bold": "var(--cds-font-wght-bold),",
				"--cds-font-axis-wght-body": "var(--cds-font-wght-body),",
				"--cds-font-axis-wght-control": "var(--cds-font-wght-control),",
				"--cds-font-axis-wght-header": "var(--cds-font-wght-header),",
				"--cds-font-axis-wght-badge": "var(--cds-font-wght-badge),",
				"--cds-prose-axis-wght-heading-serif": '"wght" 480,',
			},
		);
	});

	it("fizzy-lake type sets the role axes 360/395/480/480, and 380/420/500/480 with the system interface font", () =>
	{
		expect(
			{
				type: pickDeclarations(cssDeclarations(globals, ':root[data-cds-fizzy-lake~="type"]'), AXIS_TOKENS),
				system: pickDeclarations(
					cssDeclarations(globals, ':root[data-cds-fizzy-lake~="type"][data-interface-font="system"]'),
					AXIS_TOKENS,
				),
			},
		).toStrictEqual(
			{
				type:
				{
					"--cds-font-wght-body": '"wght" 360',
					"--cds-font-wght-control": '"wght" 395',
					"--cds-font-wght-header": '"wght" 480',
					"--cds-font-wght-badge": '"wght" 480',
				},
				system:
				{
					"--cds-font-wght-body": '"wght" 380',
					"--cds-font-wght-control": '"wght" 420',
					"--cds-font-wght-header": '"wght" 500',
					"--cds-font-wght-badge": '"wght" 480',
				},
			},
		);
	});

	it("OpenDyslexic resets the role axes like upstream's [data-dyslexic-font], after the type block so it wins", () =>
	{
		const selector = ':root[data-interface-font="dyslexic"]';
		const typeIndex = globals.findIndex((rule) => rule.selector === ':root[data-cds-fizzy-lake~="type"]');
		const dyslexicIndex = globals.findIndex((rule) => rule.selector === selector);
		expect(
			{
				declarations: pickDeclarations(cssDeclarations(globals, selector), AXIS_TOKENS),
				afterType: dyslexicIndex > typeIndex,
			},
		).toStrictEqual(
			{
				declarations:
				{
					"--cds-font-wght-body": "initial",
					"--cds-font-wght-control": "initial",
					"--cds-font-wght-header": "initial",
					"--cds-font-wght-badge": "initial",
				},
				afterType: true,
			},
		);
	});
});

describe("root consumer and per-weight axis re-declaration (T2)", () =>
{
	it(":root applies the body axis to every text node", () =>
	{
		expect(cssDeclarations(globals, ":root", [])).toMatchObject(
			axis("var(--cds-font-axis-wght-body, var(--cds-font-axis-wght-regular,))"),
		);
	});

	it("dark weight utilities re-declare their axis, through the role override that font-control sets", () =>
	{
		const rules =
		{
			normal: ":where(.dark) :is(.font-normal, .font-control-regular)",
			medium: ":where(.dark) :is(.font-medium, .font-control)",
			semibold: ":where(.dark) .font-semibold",
			bold: ":where(.dark) .font-bold",
			bInWeight: ":where(.dark) :is(.font-normal, .font-medium, .font-semibold) :is(b, strong)",
			bareB: ':where(.dark) :is(b, strong):where(:not([class*="font"]))',
			classedB: ':where(.dark) :is(b, strong):where([class*="font"])',
			role: ".font-control-regular",
		};
		expect(
			Object.fromEntries(
				Object.entries(rules).map(([key, selector]) => [key, cssDeclarations(globals, selector)]),
			),
		).toStrictEqual(
			{
				normal: axis(
					"var(--_cds-font-axis-wght-role, var(--cds-font-axis-wght-body, var(--cds-font-axis-wght-regular)))",
				),
				medium: axis(
					"var(--_cds-font-axis-wght-role, var(--cds-font-axis-wght-control, var(--cds-font-axis-wght-medium)))",
				),
				semibold: axis(
					"var(--_cds-font-axis-wght-role, var(--cds-font-axis-wght-header, var(--cds-font-axis-wght-semibold)))",
				),
				bold: axis("var(--_cds-font-axis-wght-role, var(--cds-font-axis-wght-bold))"),
				bInWeight: axis("var(--cds-font-axis-wght-bold)"),
				bareB: axis("var(--cds-font-axis-wght-bold)"),
				classedB: axis("initial"),
				role:
				{
					"--_cds-font-axis-wght-role": "var(--cds-font-axis-wght-control)",
				},
			},
		);
	});

	it("elements with a weight from elsewhere reset the axis so their own font-weight shows; code stays normal", () =>
	{
		const rules =
		{
			th: ":where(:root) th",
			arbitrary: '[class*="font-["]',
			inlineStyle:
				'[style*="font-weight"]:where(:not([style*="font-weight: 400"], [style*="font-weight:400"], [style*="font-weight: normal"], [style*="font-weight:normal"]))',
			mono: "pre",
		};
		expect(
			Object.fromEntries(
				Object.entries(rules).map(([key, selector]) => [key, cssDeclarations(globals, selector)]),
			),
		).toStrictEqual(
			{
				th: axis("initial"),
				arbitrary: axis("initial"),
				inlineStyle: axis("initial"),
				mono:
				{
					"font-feature-settings": '"liga" 0, "calt" 0',
					"font-variant-ligatures": "none",
					"font-variation-settings": "var(--default-mono-font-variation-settings, normal)",
				},
			},
		);
	});

	it("registers the role override as non-inherited, like upstream's Tailwind @property", () =>
	{
		expect(
			readFileSync("src/styles/globals.css", "utf8")
				.match(/@property --_cds-font-axis-wght-role\s*\{[^}]*\}/)?.[0]
				.replaceAll(/\s+/g, " "),
		).toStrictEqual('@property --_cds-font-axis-wght-role { syntax: "*"; inherits: false; }');
	});

	it("every font-* class in src is a weight with an axis rule or a known family/feature utility", () =>
	{
		const known = new Set([
			"font-normal",
			"font-medium",
			"font-semibold",
			"font-bold",
			"font-control",
			"font-control-regular",
			"font-mono",
			"font-mono-ui",
			"font-sans",
			"font-voice",
			"font-size",
			"font-family",
			"font-feature-settings",
			"font-weight",
			// The CSP directive mermaid-render.ts injects into its sandbox frame.
			"font-src",
			// The CSS property and SVG attribute the mermaid drawing audit refuses.
			"font-variant",
		]);
		const files = readdirSync(
			"src",
			{
				recursive: true,
				encoding: "utf8",
			},
		).filter((file) => /\.tsx?$/.test(file));
		const unknown = new Set<string>();
		for (const file of files)
		{
			for (const match of readFileSync(join("src", file), "utf8").matchAll(
				/(?:^|["'`\s:])(font-[a-z0-9[\]_-]+)/gm,
			))
			{
				const name = match[1] ?? "";
				if (!known.has(name) && !/^font-\[\d+\]$/.test(name)) unknown.add(`${file}: ${name}`);
			}
		}
		expect([...unknown]).toStrictEqual([]);
	});
});

describe("markdown prose axes (T3)", () =>
{
	it("gives prose body, headings, bold and table headers upstream's axes; code keeps normal", () =>
	{
		const rules =
		{
			root: ".markdown",
			headings: ".markdown :is(h1, h2, h3, h4, h5, h6)",
			headingBold: ".markdown :is(h1, h2, h3, h4, h5, h6) :is(strong, b)",
			bold: ".markdown :is(strong, b, dt, summary)",
			th: ".markdown th",
			code: ".markdown :is(pre, code)",
		};
		expect(
			Object.fromEntries(
				Object.entries(rules).map(([key, selector]) => [
					key,
					pickDeclarations(
						cssDeclarations(markdown, selector),
						/^(--cds-font-axis-wght|font-variation-settings)$/,
					),
				]),
			),
		).toStrictEqual(
			{
				root: axis("var(--cds-font-axis-wght-body, var(--cds-font-axis-wght-regular,))"),
				headings: axis("var(--_prose-heading-axis-wght, var(--cds-font-axis-wght-semibold,))"),
				headingBold:
				{
					"--cds-font-axis-wght": "inherit",
					"font-variation-settings": "inherit",
				},
				bold: axis("var(--cds-font-axis-wght-bold,)"),
				th: axis("var(--cds-font-axis-wght-medium,)"),
				code:
				{
					"font-variation-settings": "normal",
				},
			},
		);
	});

	it("switches prose table headers to the bold axis under forced colors", () =>
	{
		expect(cssDeclarations(markdown, ".markdown th", ["@media (forced-colors: active)"])).toStrictEqual(
			axis("var(--cds-font-axis-wght-bold,)"),
		);
	});
});
