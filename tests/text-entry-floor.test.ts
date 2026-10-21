import {readdirSync, readFileSync} from "node:fs";
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

/** Every `<input`, `<textarea` and `<select` JSX opening tag in `source`, up to its closing `>` at brace depth 0. */
function fieldTags(source: string): string[] {
	const tags: string[] = [];
	for (const match of source.matchAll(/<(input|textarea|select)\b/g)) {
		let depth = 0;
		let quote: string | undefined;
		let i = match.index + match[0].length;
		for (; i < source.length; i++) {
			const ch = source[i];
			if (quote) {
				if (ch === "\\") i++;
				else if (ch === quote) quote = undefined;
			} else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
			else if (ch === "{") depth++;
			else if (ch === "}") depth--;
			else if (ch === ">" && depth === 0) break;
		}
		tags.push(source.slice(match.index, i + 1));
	}
	return tags;
}

/** Fields whose size could beat the unlayered floor: an `!text-` utility or an inline `fontSize`. */
function floorOffenders(file: string, source: string): string[] {
	return fieldTags(source)
		.filter((tag) => /!text-|\bfontSize\b|font-size/.test(tag))
		.map((tag) => `${file}: ${normalize(tag)}`);
}

describe("text-entry floor audit", () => {
	it("flags an !text- utility or an inline fontSize on a field", () => {
		const source = [
			'<input className="!text-xs" />',
			"<textarea\n\tonChange={(e) => set(e.target.value)}\n\tstyle={{fontSize: 13}}\n/>",
			'<select className="text-xs">',
			'<input type="checkbox" className="text-sm" />',
		].join("\n");
		expect(floorOffenders("x.tsx", source)).toStrictEqual([
			'x.tsx: <input className="!text-xs" />',
			"x.tsx: <textarea onChange={(e) => set(e.target.value)} style={{fontSize: 13}} />",
		]);
	});

	it("has no field in src that a utility or inline style could hide from the floor", () => {
		const srcRoot = resolve(__dirname, "..", "src");
		const files = readdirSync(srcRoot, {recursive: true, encoding: "utf8"})
			.filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
			.toSorted();
		expect(files.length).toBeGreaterThan(0);
		expect(
			files.flatMap((file) => floorOffenders(file, readFileSync(resolve(srcRoot, file), "utf8"))),
		).toStrictEqual([]);
	});
});
