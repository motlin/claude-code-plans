import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

/* Whitespace-normalised, with no padding inside parentheses, so formatter line breaks don't matter. */
const styles = readFileSync("src/styles/globals.css", "utf8")
	.replaceAll(/\/\*.*?\*\//gs, "")
	.replaceAll(/\s+/g, " ")
	.replaceAll("( ", "(")
	.replaceAll(" )", ")");

const GROUND = '[data-cds="Page"] [data-cds-part="page-header-ground"]';

/** Every rule whose selector is exactly `selector`, as its enclosing at-rule preludes plus its parsed declarations. */
function rules(selector: string): {atRules: string[]; declarations: Record<string, string>}[] {
	const found: {atRules: string[]; declarations: Record<string, string>}[] = [];
	const stack: string[] = [];
	let start = 0;
	for (let i = 0; i < styles.length; i++) {
		if (styles[i] === "{") {
			const prelude = styles.slice(start, i).trim();
			if (prelude === selector) {
				const end = styles.indexOf("}", i);
				const declarations: Record<string, string> = {};
				for (const declaration of styles.slice(i + 1, end).split(";")) {
					const colon = declaration.indexOf(":");
					if (colon !== -1)
						declarations[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
				}
				found.push({atRules: stack.filter((p) => p.startsWith("@")), declarations});
				i = end;
				start = end + 1;
				continue;
			}
			stack.push(prelude);
			start = i + 1;
		} else if (styles[i] === "}") {
			stack.pop();
			start = i + 1;
		} else if (styles[i] === ";") {
			start = i + 1;
		}
	}
	return found;
}

describe("page-header-ground CSS (upstream c6a992d55)", () => {
	it("frosts the ground at 85% page colour with a 12px blur, falling back to opaque for reduced transparency, more contrast, forced colors, print and no backdrop-filter", () => {
		expect(rules(GROUND)).toStrictEqual([
			{
				atRules: [],
				declarations: {
					"--_toolbar-ground-fill": "85%",
					"z-index": "-1",
					"pointer-events": "none",
					"-webkit-user-select": "none",
					"user-select": "none",
					"background-color":
						"color-mix(in srgb, var(--color-page) var(--_toolbar-ground-fill), transparent)",
					"-webkit-backdrop-filter": "blur(12px)",
					"backdrop-filter": "blur(12px)",
					position: "absolute",
					inset: "0",
				},
			},
			{
				atRules: [
					"@media (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active), print",
				],
				declarations: {
					"--_toolbar-ground-fill": "100%",
					"-webkit-backdrop-filter": "none",
					"backdrop-filter": "none",
				},
			},
			{
				atRules: ["@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))"],
				declarations: {"--_toolbar-ground-fill": "100%"},
			},
		]);
	});
});
