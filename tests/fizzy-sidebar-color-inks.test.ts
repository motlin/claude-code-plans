import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

/*
 * Upstream's fizzy-lake `color` sidebar ink remaps (dumps/fizzy-sidebar-color-inks-2026-11-03.txt),
 * .llm/upstream-sync/features/fizzy-sidebar-color-inks.md T1-T2.
 */

const styles = readFileSync("src/styles/globals.css", "utf8");

/** Comments dropped and whitespace collapsed, so selectors match however the formatter wraps them. */
function normalize(css: string): string {
	return css
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\s+/g, " ")
		.replace(/\(\s/g, "(")
		.replace(/\s\)/g, ")");
}

const flatStyles = normalize(styles);

/** Where the rule whose selector list is exactly `selector` starts in the flattened sheet, or -1. */
function ruleIndex(selector: string): number {
	const wanted = `${normalize(selector).trim()} {`;
	let open = flatStyles.indexOf(wanted);
	while (open !== -1) {
		const before = flatStyles[open - 2];
		if (before === undefined || [";", "{", "}"].includes(before)) return open;
		open = flatStyles.indexOf(wanted, open + 1);
	}
	return -1;
}

/** The declarations of the first rule whose selector list is exactly `selector`, at any nesting depth. */
function rule(selector: string): Record<string, string> | null {
	const open = ruleIndex(selector);
	if (open === -1) return null;
	const start = open + `${normalize(selector).trim()} {`.length;
	const body = flatStyles.slice(start, flatStyles.indexOf("}", start));
	return Object.fromEntries(
		body
			.split(";")
			.map((declaration) => declaration.trim())
			.filter((declaration) => declaration !== "")
			.map((declaration) => {
				const colon = declaration.indexOf(":");
				return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
			}),
	);
}

/** Whether the rule starts a line unindented, so it sits outside every `@layer` (and beats layered rules). */
function topLevel(selector: string): boolean {
	return styles.includes(`\n${selector.split(",")[0]!.trim()}`);
}

const FZ = ':root[data-cds-fizzy-lake~="color"] .dframe-sidebar';
const SLOT = `${FZ} .df-leading-slot`;
const INHERIT = [
	`${FZ} :is(.group, [data-row]):focus-visible .df-leading-slot`,
	`${FZ} :is(.group, [data-row]):has(:focus-visible) .df-leading-slot`,
	`${FZ} [data-menu-open="true"] .df-leading-slot`,
	`${FZ} [data-context-menu-open="true"] .df-leading-slot`,
	`${FZ} [data-selected] .df-leading-slot`,
	`${FZ} [data-editing] .df-leading-slot`,
	`${FZ} [data-edit-box] .df-leading-slot`,
].join(", ");
const HOVER = `${FZ} :is(.group, [data-row]):hover .df-leading-slot`;
const ROW_NAV = `${FZ} [data-row-nav] .df-leading-slot`;

describe("fizzy sidebar color inks", () => {
	it("T1: the sidebar scope reads secondary as primary and muted as the fizzy secondary (upstream rules 1 and 8)", () => {
		expect({rule: rule(FZ), topLevel: topLevel(FZ)}).toStrictEqual({
			rule: {
				"--color-secondary": "var(--color-primary)",
				"--upstream-text-secondary": "var(--upstream-text-primary)",
				"--upstream-plain-secondary": "var(--upstream-text-primary)",
				"--color-ink-muted": "var(--fizzy-lake-color-secondary)",
				"--upstream-text-muted": "var(--fizzy-lake-color-secondary)",
				"--sb-icon-rest": "var(--fizzy-lake-color-secondary)",
			},
			topLevel: true,
		});
	});

	it("T1: sidebar badges keep the fizzy secondary ink (upstream rule 2)", () => {
		expect(rule(`${FZ} [data-cds="Badge"]`)).toStrictEqual({
			"--color-secondary": "var(--fizzy-lake-color-secondary)",
			"--upstream-text-secondary": "var(--fizzy-lake-color-secondary)",
		});
	});

	it("T1: the group mark resets muted to the scoped sidebar muted (upstream --df-sidebar-muted)", () => {
		expect(rule(':root[data-cds-fizzy-lake~="color"] [data-sidebar-group-label] [data-group-mark]')).toStrictEqual({
			"--color-ink-muted": "var(--upstream-text-muted)",
			"--muted-as-secondary": "var(--fizzy-lake-color-secondary, var(--upstream-text-muted))",
			"--color-secondary": "var(--fizzy-lake-color-secondary, var(--upstream-text-muted))",
		});
	});

	it("T1: the scope never redefines --fizzy-lake-color-secondary, so it inherits the root #0009", () => {
		expect(rule(FZ)?.["--fizzy-lake-color-secondary"]).toBeUndefined();
	});

	it("T2: leading icons rest at the fizzy secondary and inherit the row ink on interaction (upstream rules 4-5)", () => {
		expect({
			rest: rule(SLOT),
			restTopLevel: topLevel(SLOT),
			inherit: rule(INHERIT),
			inheritTopLevel: topLevel(INHERIT),
			hover: flatStyles.includes(`@media (hover: hover) { ${normalize(HOVER)} { color: inherit; } }`),
		}).toStrictEqual({
			rest: {color: "var(--sb-icon-rest)"},
			restTopLevel: true,
			inherit: {color: "inherit"},
			inheritTopLevel: true,
			hover: true,
		});
	});

	it("T2: nav-variant rows always paint their icon primary, after the inherit rules (upstream rule 6)", () => {
		const rowNav = ruleIndex(ROW_NAV);
		expect({
			rule: rule(ROW_NAV),
			topLevel: topLevel(ROW_NAV),
			afterRest: rowNav > ruleIndex(SLOT),
			afterInherit: rowNav > ruleIndex(INHERIT),
			afterHover: rowNav > flatStyles.indexOf(normalize(HOVER)),
		}).toStrictEqual({
			rule: {color: "var(--upstream-text-primary)"},
			topLevel: true,
			afterRest: true,
			afterInherit: true,
			afterHover: true,
		});
	});
});
