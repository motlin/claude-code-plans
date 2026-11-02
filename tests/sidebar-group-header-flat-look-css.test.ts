import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

/* Whitespace-normalised, with no padding inside parentheses, so formatter line breaks don't matter. */
const styles = readFileSync("src/styles/globals.css", "utf8")
	.replaceAll(/\s+/g, " ")
	.replaceAll("( ", "(")
	.replaceAll(" )", ")");

const FLAT = "[data-hub-rail]";
const LABEL = `${FLAT} [data-sidebar-group-label]`;
const BADGE_LABEL = `${LABEL}:has(> [data-header-controls])`;

/** The at-rule preludes enclosing the first occurrence of `selector {`, outermost first. */
function enclosingAtRules(selector: string): string[]
{
	const end = styles.indexOf(`${selector} {`);
	if (end === -1) return ["<missing>"];
	const stack: string[] = [];
	let start = 0;
	for (let i = 0; i < end; i++)
	{
		if (styles[i] === "{")
		{
			stack.push(styles.slice(start, i).trim());
			start = i + 1;
		}
		else if (styles[i] === "}")
		{
			stack.pop();
			start = i + 1;
		}
		else if (styles[i] === ";")
		{
			start = i + 1;
		}
	}
	return stack.filter((prelude) => prelude.startsWith("@"));
}

function missing(rules: readonly string[]): string[]
{
	return rules.filter((rule) => !styles.includes(rule));
}

describe("sidebar group header flat-look CSS", () =>
{
	it("remaps the label's muted and secondary inks to primary in the hub-rail sidebar, keeping the mark's own inks", () =>
	{
		expect(
			{
				colorGated: styles.includes(':root[data-cds-fizzy-lake~="color"] [data-sidebar-group-label]'),
				missing: missing([
					"--fizzy-lake-color-secondary: var(--upstream-text-secondary);",
					"[data-hub-rail] [data-sidebar-group-label] { --color-ink-muted: var(--color-primary); --muted-as-secondary: var(--color-primary); --color-secondary: var(--color-primary); }",
					"[data-hub-rail] [data-sidebar-group-label] [data-group-mark] { --color-ink-muted: var(--upstream-text-muted); --muted-as-secondary: var(--fizzy-lake-color-secondary, var(--upstream-text-muted)); --color-secondary: var(--fizzy-lake-color-secondary, var(--upstream-text-muted)); }",
				]),
			},
		).toStrictEqual(
			{
				colorGated: false,
				missing: [],
			},
		);
	});

	it("no group-header rule depends on the panels or color fizzy-lake part or on data-flat-look", () =>
	{
		const selectors = [
			...styles.replaceAll(/\/\*.*?\*\//g, "").matchAll(/[^{}]*\[data-sidebar-group-label\][^{}]*\{/g),
		].map((match) => match[0].trim());
		expect(
			selectors.filter((selector) => /data-cds-fizzy-lake~="(panels|color)"|data-flat-look/.test(selector)),
		).toStrictEqual([]);
	});

	it("copies upstream's flat-look label metrics: 12px/20px, no gaps, 4px before header glyphs", () =>
	{
		expect(
			missing([
				`${LABEL} { --sb-group-font: 12px; isolation: isolate; line-height: 20px; position: relative; }`,
				`${LABEL} input { line-height: 20px; }`,
				`${LABEL}, ${LABEL} > div { gap: 0; }`,
				`${LABEL} [data-row-glyph] { margin-inline-start: 4px; }`,
			]),
		).toStrictEqual([]);
	});

	it("fades Group and sort by opacity on a fine pointer unless the section is hovered, focused or its menu is open", () =>
	{
		const selector = `${FLAT} [data-group-key]:not([data-hover-within]) [data-sidebar-group-label]:not(:has(:focus-visible), :has([data-popup-open])) [data-header-reveal]`;
		expect(
			{
				missing: missing([`${selector} { opacity: 0; }`]),
				media: enclosingAtRules(selector),
			},
		).toStrictEqual(
			{
				missing: [],
				media: ["@media (hover: hover) and (pointer: fine)"],
			},
		);
	});

	it("parks the collapsed badge at the row end on a fine pointer and hides it while Group and sort or a trailing control shows", () =>
	{
		const toggleBadge = "h3 > [data-group-toggle] > [data-group-badge]";
		const isolation = `${BADGE_LABEL} h3 > [data-group-toggle]:has(> [data-group-badge]:not(:empty))`;
		const park = `${BADGE_LABEL} ${toggleBadge}`;
		const hidden = `${FLAT} [data-group-key][data-hover-within] [data-sidebar-group-label]:not([data-group-key]:not([data-hover-within]) [data-sidebar-group-label]):has(> [data-header-controls]) ${toggleBadge}, ${BADGE_LABEL}:has(:focus-visible) ${toggleBadge}, ${BADGE_LABEL}:has([data-popup-open]) ${toggleBadge}, ${LABEL}:has(> [data-header-controls] > :not([data-header-reveal]):focus-within) ${toggleBadge}`;
		const fine = ["@media (hover: hover) and (pointer: fine)"];
		expect(
			{
				missing: missing([
					`${isolation} { isolation: auto; position: static; }`,
					`${park} { width: var(--sb-row-ctl); height: var(--sb-row-h); pointer-events: none; margin-block: 0; position: absolute; inset-block: auto 0; inset-inline-end: var(--sb-row-ctl-inset, calc((var(--sb-row-h) - var(--sb-row-ctl)) / 2)); }`,
					`${hidden} { opacity: 0; }`,
				]),
				media: [enclosingAtRules(isolation), enclosingAtRules(park), enclosingAtRules(hidden)],
			},
		).toStrictEqual(
			{
				missing: [],
				media: [fine, fine, fine],
			},
		);
	});

	it("draws upstream's hover pill behind a hovered or menu-open header", () =>
	{
		const hovered = `${LABEL}:has(h3 > [data-group-toggle]):hover::before`;
		expect(
			{
				missing: missing([
					`${hovered}, ${LABEL}:has(h3 > [data-group-toggle]):has([data-popup-open])::before { content: ""; z-index: -1; height: var(--sb-row-h); border-radius: var(--sb-radius); background: var(--sb-hover); position: absolute; inset: auto 0 0; }`,
				]),
				media: enclosingAtRules(
					`${hovered}, ${LABEL}:has(h3 > [data-group-toggle]):has([data-popup-open])::before`,
				),
			},
		).toStrictEqual(
			{
				missing: [],
				media: ["@media (hover: hover)"],
			},
		);
	});

	it("inks the toggle fizzy secondary at rest and the label's ink on hover, focus or an open menu", () =>
	{
		const toggle = "h3 > [data-group-toggle]";
		expect(
			missing([
				`${LABEL} ${toggle} { color: var(--fizzy-lake-color-secondary, inherit); }`,
				`${LABEL} ${toggle}:focus-visible { color: inherit; }`,
				`${LABEL}:hover ${toggle}, ${LABEL}:has([data-popup-open]) ${toggle} { color: inherit; }`,
			]),
		).toStrictEqual([]);
	});
});
