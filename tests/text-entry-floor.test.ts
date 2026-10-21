import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const globalsCss = readFileSync(resolve(__dirname, "..", "src", "styles", "globals.css"), "utf8");

function normalize(text: string): string {
	return text
		.replaceAll(/\s+/g, " ")
		.replaceAll(/\s*,\s*/g, ", ")
		.replaceAll(/\(\s+/g, "(")
		.replaceAll(/\s+\)/g, ")")
		.trim();
}

/** Every top-level (unlayered) block as `[prelude, body]`, with comments stripped. */
function topLevelBlocks(css: string): [string, string][] {
	const source = css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
	const blocks: [string, string][] = [];
	let depth = 0;
	let preludeStart = 0;
	let bodyStart = 0;
	for (let i = 0; i < source.length; i++) {
		const ch = source[i];
		if (ch === "{") {
			if (depth === 0) bodyStart = i + 1;
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth === 0) {
				const prelude = source.slice(preludeStart, bodyStart - 1).trim();
				const lastStatement = prelude.slice(prelude.lastIndexOf(";") + 1).trim();
				blocks.push([lastStatement, source.slice(bodyStart, i)]);
				preludeStart = i + 1;
			}
		} else if (ch === ";" && depth === 0) {
			preludeStart = i + 1;
		}
	}
	return blocks;
}

/** The unlayered `@media (pointer: coarse)` blocks' bodies. */
const coarseBodies = topLevelBlocks(globalsCss)
	.filter(([prelude]) => normalize(prelude) === "@media (pointer: coarse)")
	.map(([, body]) => body);

function rulesOf(body: string): string[] {
	return topLevelBlocks(body).map(
		([selector, declarations]) => `${normalize(selector)} { ${normalize(declarations)} }`,
	);
}

describe("global text-entry floor on coarse pointers", () => {
	it("copies upstream's unlayered floor rules for every text field", () => {
		expect(coarseBodies.flatMap(rulesOf)).toStrictEqual([
			":root { --text-entry-floor: 16px; }",
			':root input:where(:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="color"]):not([type="file"])), :root textarea, :root select, :root .text-entry-floored { font-size: max(var(--text-entry-floor, 0px), var(--upstream-text-body)); }',
			":root textarea, :root .text-entry-floored { line-height: var(--cmp-leading, max(1.375em, var(--upstream-leading-body))); }",
			':root [contenteditable]:where(:not([contenteditable="false"])) { font-size: max(var(--text-entry-floor, 0px), 1em); }',
		]);
	});

	it("keys the floor on (pointer: coarse) only, not (hover: none)", () => {
		expect(coarseBodies.filter((body) => body.includes("(hover: none)"))).toStrictEqual([]);
	});
});
