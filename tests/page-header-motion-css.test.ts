import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

/* Whitespace-normalised, with no padding inside parentheses, so formatter line breaks don't matter. */
const styles = readFileSync("src/styles/globals.css", "utf8")
	.replaceAll(/\/\*.*?\*\//gs, "")
	.replaceAll(/\s+/g, " ")
	.replaceAll("( ", "(")
	.replaceAll(" )", ")");

type Rule = {atRules: string[]; selector: string; declarations: Record<string, string>};

/** Every leaf rule in the stylesheet, with its enclosing at-rule preludes and parsed declarations. */
function allRules(): Rule[] {
	const found: Rule[] = [];
	const stack: string[] = [];
	let start = 0;
	for (let i = 0; i < styles.length; i++) {
		const char = styles[i];
		if (char === "{") {
			const prelude = styles.slice(start, i).trim();
			const end = styles.indexOf("}", i);
			const next = styles.indexOf("{", i + 1);
			if (next === -1 || end < next) {
				const declarations: Record<string, string> = {};
				for (const declaration of styles.slice(i + 1, end).split(";")) {
					const colon = declaration.indexOf(":");
					if (colon !== -1)
						declarations[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
				}
				found.push({atRules: [...stack], selector: prelude, declarations});
				i = end;
				start = end + 1;
				continue;
			}
			stack.push(prelude);
			start = i + 1;
		} else if (char === "}") {
			stack.pop();
			start = i + 1;
		} else if (char === ";") {
			start = i + 1;
		}
	}
	return found;
}

function rulesIn(atRule: string): Omit<Rule, "atRules">[] {
	return allRules()
		.filter((rule) => rule.atRules.length === 1 && rule.atRules[0] === atRule)
		.map(({selector, declarations}) => ({selector, declarations}));
}

describe("page-header title-leaves / tabs-arrive CSS (upstream c6a992d55)", () => {
	it("copies the cds-page-title-leaves keyframes: fade and sink 20px at .96 scale on the first step", () => {
		expect(rulesIn("@keyframes cds-page-title-leaves")).toStrictEqual([
			{selector: "0%", declarations: {opacity: "1", transform: "none"}},
			{selector: "0.001%, to", declarations: {opacity: "0", transform: "translateY(20px) scale(0.96)"}},
		]);
	});

	it("copies the cds-page-tabs-arrive keyframes: from the pull with a .45/.55 ease to rest", () => {
		expect(rulesIn("@keyframes cds-page-tabs-arrive")).toStrictEqual([
			{
				selector: "0%",
				declarations: {
					translate: "var(--cds-page-header-tabs-pull)",
					"animation-timing-function": "cubic-bezier(0.45, 0, 0.55, 1)",
				},
			},
			{selector: "0.005%, to", declarations: {translate: "0"}},
		]);
	});

	it("runs both on the scroll timeline only where animation-timeline is supported", () => {
		expect(rulesIn("@supports (animation-timeline: scroll())")).toStrictEqual([
			{
				selector: '[data-cds-title-leaves] [data-cds-part="page-title-motion"]',
				declarations: {
					"animation-name": "cds-page-title-leaves",
					"animation-duration": "auto",
					"animation-timing-function": "linear",
					"animation-timeline": "scroll()",
					"animation-range": "0 2800000px",
				},
			},
			{
				selector: "[data-cds-tabs-arrive]",
				declarations: {"--cds-page-header-tabs-pull": "0px", "--cds-page-header-tabs-travel": "1px"},
			},
			{
				selector: '[data-cds-tabs-arrive] [data-cds-part="tabs-row"]',
				declarations: {
					translate: "var(--cds-page-header-tabs-pull)",
					"animation-name": "cds-page-tabs-arrive",
					"animation-duration": "auto",
					"animation-timing-function": "linear",
					"animation-timeline": "scroll()",
					"animation-range": "0px calc(var(--cds-page-header-tabs-travel) * 20000)",
				},
			},
			{
				selector:
					'[data-cds-title-leaves] [data-cds-part="page-title-motion"], [data-cds-tabs-arrive] [data-cds-part="tabs-row"]',
				declarations: {"z-index": "1"},
			},
			{
				selector:
					'[data-cds-title-leaves]:not([data-cds-row-level]) [data-cds-part="page-title-motion"], [data-cds-tabs-arrive] [data-cds-part="tabs-row"]',
				declarations: {position: "relative"},
			},
		]);
	});
});
