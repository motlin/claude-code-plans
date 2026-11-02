import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";
import {ruleStart} from "./css-rule";
import {loadDesignSystem} from "./helpers/tailwind-design-system";

async function compile(candidate: string): Promise<string | null>
{
	const [rule] = (await loadDesignSystem()).candidatesToCss([candidate]);
	return rule ?? null;
}

async function normalized(candidate: string): Promise<string>
{
	return (await compile(candidate))?.replaceAll(/\s+/g, " ").trim() ?? "";
}

const styles = (): string => readFileSync("src/styles/globals.css", "utf8");
const flatStyles = (): string => styles().replaceAll(/\s+/g, " ");

describe("scroll-fade-y", () =>
{
	it("ports cds' scroll-driven edge fade: scroll padding always, the mask only where scroll timelines exist", async () =>
	{
		const rule = await normalized("scroll-fade-y");
		const css = styles();

		expect(
			{
				scrollPadding: rule.includes(
					"scroll-padding-block: calc(var(--scroll-fade-size) * var(--scroll-fade-top-on)) calc(var(--scroll-fade-size) * var(--scroll-fade-bottom-on));",
				),
				physicalPadding: rule.includes("scroll-padding-top"),
				supports: rule.includes("@supports (animation-timeline: scroll())"),
				mask: rule.includes("mask-image: linear-gradient( to bottom, transparent,"),
				timeline: rule.includes("animation-timeline: scroll(self block);"),
				ranges: rule.includes(
					"animation-range: 0px var(--scroll-fade-size), calc(100% - var(--scroll-fade-size)) 100%, 0px 101%;",
				),
				keyframes: ["scroll-fade-top", "scroll-fade-bottom", "scroll-fade-y-active"].map(
					(name) => ruleStart(css, `@keyframes ${name}`) !== -1,
				),
				properties: ["size", "top-on", "bottom-on"].map(
					(name) =>
						/@property --scroll-fade-[a-z-]+\s*\{[^}]*\}/
							.exec(css.slice(ruleStart(css, `@property --scroll-fade-${name}`)))?.[0]
							.includes("inherits: false;") ?? false,
				),
				size: css.includes(
					'@property --scroll-fade-size\n{\n\tsyntax: "<length>";\n\tinherits: false;\n\tinitial-value: 28px;\n}',
				),
			},
		).toStrictEqual(
			{
				scrollPadding: true,
				physicalPadding: false,
				supports: true,
				mask: true,
				timeline: true,
				ranges: true,
				keyframes: [true, true, true],
				properties: [true, true, true],
				size: true,
			},
		);
	});
});

describe("scroll-fade modifiers", () =>
{
	it("ports upstream's per-edge hide switches and size utilities", async () =>
	{
		const candidates = [
			"scroll-fade-hide-top",
			"scroll-fade-hide-bottom",
			"scroll-fade-hide-left",
			"scroll-fade-hide-right",
			"scroll-fade-size-6",
			"scroll-fade-size-16",
			"scroll-fade-size-[8px]",
			"scroll-fade-size-[calc(1*var(--upstream-leading-footnote))]",
		];
		const rules = await Promise.all(candidates.map(async (candidate) => normalized(candidate)));

		expect(rules).toStrictEqual([
			".scroll-fade-hide-top { --scroll-fade-top-on: 0; }",
			".scroll-fade-hide-bottom { --scroll-fade-bottom-on: 0; }",
			".scroll-fade-hide-left { --scroll-fade-left-on: 0; }",
			".scroll-fade-hide-right { --scroll-fade-right-on: 0; }",
			".scroll-fade-size-6 { --scroll-fade-size: calc(var(--spacing) * 6); }",
			".scroll-fade-size-16 { --scroll-fade-size: calc(var(--spacing) * 16); }",
			".scroll-fade-size-\\[8px\\] { --scroll-fade-size: 8px; }",
			".scroll-fade-size-\\[calc\\(1\\*var\\(--upstream-leading-footnote\\)\\)\\] { --scroll-fade-size: calc(1 * var(--upstream-leading-footnote)); }",
		]);
	});

	it("compiles the variant forms upstream's consumers rely on", async () =>
	{
		const focus = await normalized("focus-visible:scroll-fade-hide-top");
		const scrollable = await normalized("data-[scrollable]:scroll-fade-y");
		const padding = await normalized("scroll-py-(--scroll-fade-size)");

		expect(
			{
				focus,
				scrollable:
				{
					selector: scrollable.startsWith(".data-\\[scrollable\\]\\:scroll-fade-y[data-scrollable] {"),
					padding: scrollable.includes(
						"scroll-padding-block: calc(var(--scroll-fade-size) * var(--scroll-fade-top-on))",
					),
					animation:
						scrollable.includes("@supports (animation-timeline: scroll()) { --scroll-fade-top:") &&
						scrollable.includes(
							"animation-name: scroll-fade-top, scroll-fade-bottom, scroll-fade-y-active;",
						),
				},
				padding,
			},
		).toStrictEqual(
			{
				focus: ".focus-visible\\:scroll-fade-hide-top:focus-visible { --scroll-fade-top-on: 0; }",
				scrollable:
				{
					selector: true,
					padding: true,
					animation: true,
				},
				padding: ".scroll-py-\\(--scroll-fade-size\\) { scroll-padding-block: var(--scroll-fade-size); }",
			},
		);
	});
});

describe("scroll-fade (both axes)", () =>
{
	it("ports upstream's two-axis fade: four-sided scroll padding and two intersecting masks", async () =>
	{
		const rule = await normalized("scroll-fade");

		expect(
			{
				padding: rule.includes(
					"scroll-padding: calc(var(--scroll-fade-size) * var(--scroll-fade-top-on)) calc(var(--scroll-fade-size) * var(--scroll-fade-right-on)) calc(var(--scroll-fade-size) * var(--scroll-fade-bottom-on)) calc(var(--scroll-fade-size) * var(--scroll-fade-left-on));",
				),
				supports: rule.includes("@supports (animation-timeline: scroll())"),
				mask:
					rule.includes("mask-image: linear-gradient( to bottom, transparent,") &&
					rule.includes("transparent ), linear-gradient( to right, transparent,"),
				composite: rule.includes("mask-composite: intersect;"),
				names: rule.includes(
					"animation-name: scroll-fade-top, scroll-fade-bottom, scroll-fade-left, scroll-fade-right, scroll-fade-y-active, scroll-fade-x-active;",
				),
				fill: rule.includes("animation-fill-mode: both, both, both, both, none, none;"),
				timelines: rule.includes(
					"animation-timeline: scroll(self), scroll(self), scroll(self inline), scroll(self inline), scroll(self), scroll(self inline);",
				),
				ranges: rule.includes(
					"animation-range: 0px var(--scroll-fade-size), calc(100% - var(--scroll-fade-size)) 100%, 0px var(--scroll-fade-size), calc(100% - var(--scroll-fade-size)) 100%, 0px 101%, 0px 101%;",
				),
				rtl: rule.includes(
					'&:where(:root[dir="rtl"] :dir(rtl)) { --scroll-fade-left: calc( var(--scroll-fade-right-raw) * var(--scroll-fade-x-active) * var(--scroll-fade-left-on) );',
				),
			},
		).toStrictEqual(
			{
				padding: true,
				supports: true,
				mask: true,
				composite: true,
				names: true,
				fill: true,
				timelines: true,
				ranges: true,
				rtl: true,
			},
		);
	});
});

describe("scroll-fade-x RTL swap", () =>
{
	it("swaps the edges only under an RTL root, as upstream's :where(:root[dir=rtl] :dir(rtl)) does", async () =>
	{
		const rule = await normalized("scroll-fade-x");

		expect(
			{
				upstream: rule.includes('&:where(:root[dir="rtl"] :dir(rtl)) {'),
				broad: rule.includes('[dir="rtl"] *'),
			},
		).toStrictEqual(
			{
				upstream: true,
				broad: false,
			},
		);
	});
});

describe("scroll-fade-strip", () =>
{
	const strip = (edge: "top" | "bottom"): string =>
	{
		const surface = "var(--scroll-fade-strip-color, var(--color-surface-1))";
		return `linear-gradient( to ${edge}, ${surface}, rgb(from ${surface} r g b / 0.85) 13%, rgb(from ${surface} r g b / 0.5) 40%, rgb(from ${surface} r g b / 0.15) 70%, transparent )`;
	};

	it("ports scroll-fade-strip-top: a sticky surface gradient whose opacity follows the nearest scroller", async () =>
	{
		const rule = await normalized("scroll-fade-strip-top");

		expect(rule).toStrictEqual(
			`.scroll-fade-strip-top { height: var(--scroll-fade-size); margin-bottom: calc(var(--scroll-fade-size) * -1); pointer-events: none; z-index: 1; opacity: 0; background: ${strip("bottom")}; top: 0; position: sticky; inset-inline-start: 0; @supports (animation-timeline: scroll()) { opacity: calc(var(--scroll-fade-strip-raw) * var(--scroll-fade-strip-active)); animation-name: scroll-fade-strip-in, scroll-fade-strip-active; animation-timing-function: linear; animation-fill-mode: both, none; animation-duration: auto; animation-timeline: scroll(), scroll(); animation-range: 0px var(--scroll-fade-size), 0px 101%; } }`,
		);
	});

	it("ports scroll-fade-strip-bottom as the mirror image", async () =>
	{
		const rule = await normalized("scroll-fade-strip-bottom");

		expect(rule).toStrictEqual(
			`.scroll-fade-strip-bottom { height: var(--scroll-fade-size); margin-top: calc(var(--scroll-fade-size) * -1); pointer-events: none; z-index: 1; opacity: 0; background: ${strip("top")}; bottom: 0; position: sticky; inset-inline-start: 0; @supports (animation-timeline: scroll()) { opacity: calc(var(--scroll-fade-strip-raw) * var(--scroll-fade-strip-active)); animation-name: scroll-fade-strip-out, scroll-fade-strip-active; animation-timing-function: linear; animation-fill-mode: both, none; animation-duration: auto; animation-timeline: scroll(), scroll(); animation-range: calc(100% - var(--scroll-fade-size)) 100%, 0px 101%; } }`,
		);
	});

	it("registers the strip properties and keyframes, and defaults the strip color per surface", () =>
	{
		const css = flatStyles();
		const rules = [
			'@property --scroll-fade-strip-raw { syntax: "<number>"; inherits: false; initial-value: 0; }',
			'@property --scroll-fade-strip-active { syntax: "<number>"; inherits: false; initial-value: 0; }',
			"@keyframes scroll-fade-strip-in { 0% { --scroll-fade-strip-raw: 0; } to { --scroll-fade-strip-raw: 1; } }",
			"@keyframes scroll-fade-strip-out { 0% { --scroll-fade-strip-raw: 1; } to { --scroll-fade-strip-raw: 0; } }",
			"@keyframes scroll-fade-strip-active { 0%, to { --scroll-fade-strip-active: 1; } }",
			":where(.bg-surface-0) { --scroll-fade-strip-color: var(--color-surface-0); }",
			":where(.bg-surface-1) { --scroll-fade-strip-color: var(--color-surface-1); }",
			":where(.bg-surface-2) { --scroll-fade-strip-color: var(--color-surface-2); }",
			":where(.bg-surface-3) { --scroll-fade-strip-color: var(--color-surface-3); }",
			":where(.bg-surface-popover) { --scroll-fade-strip-color: var(--color-surface-popover); }",
			':where([data-cds="Card"]) { --scroll-fade-strip-color: var(--color-surface-1); }',
		];

		expect(rules.filter((rule) => !css.includes(rule))).toStrictEqual([]);
	});
});

describe("transcript fade variables", () =>
{
	it("compiles the feed's article scroll margins under a [role=article] descendant selector", async () =>
	{
		expect(
			{
				top: await normalized(
					"[&_[role=article]]:[scroll-margin-top:calc(max(var(--epitaxy-top-fade-height,0px),var(--fade-top,0px))+8px)]",
				),
				bottom: await normalized(
					"[&_[role=article]]:[scroll-margin-bottom:calc(max(var(--epitaxy-bottom-fade-height,0px)-var(--epitaxy-foot-reserve,0px),0px)+8px)]",
				),
			},
		).toStrictEqual(
			{
				top: String.raw`.\[\&_\[role\=article\]\]\:\[scroll-margin-top\:calc\(max\(var\(--epitaxy-top-fade-height\,0px\)\,var\(--fade-top\,0px\)\)\+8px\)\] [role=article] { scroll-margin-top: calc(max(var(--epitaxy-top-fade-height,0px), var(--fade-top,0px)) + 8px); }`,
				bottom: String.raw`.\[\&_\[role\=article\]\]\:\[scroll-margin-bottom\:calc\(max\(var\(--epitaxy-bottom-fade-height\,0px\)-var\(--epitaxy-foot-reserve\,0px\)\,0px\)\+8px\)\] [role=article] { scroll-margin-bottom: calc(max(var(--epitaxy-bottom-fade-height,0px) - var(--epitaxy-foot-reserve,0px), 0px) + 8px); }`,
			},
		);
	});

	it("sets ScrollFade's 32px/48px fade heights only where scroll timelines exist", async () =>
	{
		expect(
			{
				top: await normalized("supports-[animation-timeline:scroll()]:[--epitaxy-top-fade-height:32px]"),
				bottom: await normalized("supports-[animation-timeline:scroll()]:[--epitaxy-bottom-fade-height:48px]"),
			},
		).toStrictEqual(
			{
				top: String.raw`@supports (animation-timeline:scroll()) { .supports-\[animation-timeline\:scroll\(\)\]\:\[--epitaxy-top-fade-height\:32px\] { --epitaxy-top-fade-height: 32px; } }`,
				bottom: String.raw`@supports (animation-timeline:scroll()) { .supports-\[animation-timeline\:scroll\(\)\]\:\[--epitaxy-bottom-fade-height\:48px\] { --epitaxy-bottom-fade-height: 48px; } }`,
			},
		);
	});
});

describe("u-hidden-scrollbar", () =>
{
	it("ports upstream's hidden scrollbar utility", async () =>
	{
		expect(await normalized("u-hidden-scrollbar")).toStrictEqual(
			".u-hidden-scrollbar { scrollbar-width: none; &::-webkit-scrollbar { opacity: 0; width: 0; } }",
		);
	});
});
