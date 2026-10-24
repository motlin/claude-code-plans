import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import {markdownCss, ruleDeclarations} from "./markdown-css";

const globalsCss = readFileSync(resolve(__dirname, "..", "src", "styles", "globals.css"), "utf8");

/** The value `token` is assigned in the first top-level block opened by `blockSelector`. */
function tokenIn(blockSelector: string, token: string): string | undefined {
	const open = globalsCss.indexOf(`\n${blockSelector} {`);
	if (open === -1) throw new Error(`block not found: ${blockSelector}`);
	const close = globalsCss.indexOf("\n}", open);
	const match = new RegExp(`${token}:\\s*([^;]+);`).exec(globalsCss.slice(open, close));
	return match?.[1]?.trim();
}

describe("transcript link styles", () => {
	it("defines upstream's link accent once per theme", () => {
		expect({
			light: tokenIn(":root", "--upstream-accent"),
			dark: tokenIn(".dark", "--upstream-accent"),
			themeColor: tokenIn("@theme inline", "--color-upstream-accent"),
		}).toStrictEqual({
			light: "rgb(24 79 149)",
			dark: "#6da7ec",
			themeColor: "var(--upstream-accent)",
		});
	});

	it("defines upstream's pressed-toggle paint per theme", () => {
		expect({
			light: tokenIn(":root", "--upstream-accent-pressed"),
			dark: tokenIn(".dark", "--upstream-accent-pressed"),
			themeColor: tokenIn("@theme inline", "--color-upstream-accent-pressed"),
		}).toStrictEqual({
			light: "rgb(205 226 251)",
			dark: "#032042",
			themeColor: "var(--upstream-accent-pressed)",
		});
	});

	it("draws prose links in the accent, underlined 3px below at 40% of the link colour, with no hover fade", () => {
		expect(ruleDeclarations(markdownCss, ".markdown a")).toStrictEqual({
			color: "var(--upstream-accent)",
			"text-decoration-line": "underline",
			"text-decoration-color": "color-mix(in srgb, currentColor 40%, transparent)",
			"text-underline-offset": "3px",
			"border-radius": "2px",
		});
		expect(() => ruleDeclarations(markdownCss, ".markdown a:hover")).toThrow("selector not found");
	});

	it("shares the same look with links outside the markdown article", () => {
		expect(ruleDeclarations(globalsCss, ".text-link")).toStrictEqual({
			color: "var(--upstream-accent)",
			"text-decoration-line": "underline",
			"text-decoration-color": "color-mix(in srgb, currentColor 40%, transparent)",
			"text-underline-offset": "3px",
			"border-radius": "2px",
		});
	});

	it("draws file-path refs as upstream's prose-link: inline, wrapping, underlined at 40% going solid on hover and focus", () => {
		expect({
			rest: ruleDeclarations(globalsCss, ".prose-link"),
			active: ruleDeclarations(globalsCss, ".prose-link:is(:hover, :focus-visible)"),
			focus: ruleDeclarations(globalsCss, ".prose-link:focus-visible"),
			busy: ruleDeclarations(globalsCss, '.prose-link[aria-busy="true"]'),
		}).toStrictEqual({
			rest: {
				display: "inline",
				"-webkit-box-decoration-break": "clone",
				"box-decoration-break": "clone",
				"border-radius": "3px",
				color: "var(--upstream-accent)",
				cursor: "pointer",
				"--_text-link-line": "color-mix(in srgb, currentColor, transparent 60%)",
				"text-decoration-line": "underline",
				"text-decoration-color": "var(--_text-link-line)",
				"text-underline-offset": "3px",
				"transition-property": "color, text-decoration-color, box-shadow",
				"transition-duration": "60ms",
				"transition-timing-function": "cubic-bezier(0.165, 0.84, 0.44, 1)",
			},
			active: {"--_text-link-line": "currentColor"},
			focus: {
				outline: "2px solid transparent",
				"outline-offset": "2px",
				"box-shadow": "var(--focus-shadow)",
			},
			busy: {cursor: "progress", opacity: "0.6"},
		});
		expect(() => ruleDeclarations(globalsCss, ".prose-link:hover")).toThrow("selector not found");
	});

	it("draws GitHub PR links as accent-muted chips", () => {
		expect({
			chip: ruleDeclarations(markdownCss, ".markdown a:global(.pr-chip)"),
			hover: ruleDeclarations(markdownCss, ".markdown a:global(.pr-chip):hover"),
			darkChip: ruleDeclarations(markdownCss, ":global(.dark) .markdown a:global(.pr-chip)"),
			darkHover: ruleDeclarations(markdownCss, ":global(.dark) .markdown a:global(.pr-chip):hover"),
			icon: ruleDeclarations(markdownCss, ".markdown a:global(.pr-chip) svg"),
		}).toStrictEqual({
			chip: {
				"background-color": "rgb(42 120 214 / 0.1)",
				"border-radius": "4px",
				padding: "0 6px",
				"-webkit-box-decoration-break": "clone",
				"box-decoration-break": "clone",
				"text-decoration-line": "none",
			},
			hover: {"background-color": "rgb(205 226 251)"},
			darkChip: {"background-color": "rgb(42 120 214 / 0.2)"},
			darkHover: {"background-color": "rgb(42 120 214 / 0.32)"},
			icon: {
				display: "inline-block",
				"vertical-align": "-1px",
				"margin-right": "4px",
			},
		});
	});
});
