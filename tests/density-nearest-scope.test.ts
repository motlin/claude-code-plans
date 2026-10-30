// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");
const markdownStyles = readFileSync("src/components/markdown-article.module.css", "utf8");

function variantSelector(name: "compact" | "comfortable"): string {
	const body = styles.match(new RegExp(`^@custom-variant ${name} \\((.+)\\);$`, "m"))?.[1];
	if (body === undefined) throw new Error(`no @custom-variant ${name}`);
	return body.replaceAll("&", ".subject");
}

/** The transcript's comfortable prose rule, with the CSS-module `:global()` wrappers unwrapped. */
function comfortableProseSelector(): string {
	const rule = markdownStyles.match(/(:global\(\.transcript-text\)\s+\.markdown:where[\s\S]*?)\s*\{/)?.[1];
	if (rule === undefined) throw new Error("no comfortable transcript prose rule");
	return rule.replaceAll(/:global\(([^()]*)\)/g, "$1").replaceAll(/\s+/g, " ");
}

const C = "comfortable";
const K = "compact";

/** Nests the subject in `.transcript-text` and then each density scope, outermost first. */
function resolve(scopes: readonly string[]): {compact: boolean; comfortable: boolean; comfortableProse: boolean} {
	const open = scopes.map((density) => `<div data-density="${density}">`).join("");
	const close = "</div>".repeat(scopes.length);
	document.body.innerHTML = `<div class="transcript-text">${open}<div class="subject markdown"></div>${close}</div>`;
	const subject = document.querySelector(".subject");
	if (subject === null) throw new Error("no subject");
	return {
		compact: subject.matches(variantSelector("compact")),
		comfortable: subject.matches(variantSelector("comfortable")),
		comfortableProse: subject.matches(comfortableProseSelector()),
	};
}

describe("density selectors follow the nearest [data-density] scope", () => {
	it("resolves compact:, comfortable: and the comfortable prose rule to the closest scope, up to four nested scopes", () => {
		const cases = [[], [C], [K], [C, K], [K, C], [C, K, C], [K, C, K], [C, K, C, K], [K, C, K, C]] as const;

		expect(
			Object.fromEntries(cases.map((scopes) => [scopes.join(" > ") || "none", resolve(scopes)])),
		).toStrictEqual({
			none: {compact: false, comfortable: false, comfortableProse: false},
			comfortable: {compact: false, comfortable: true, comfortableProse: true},
			compact: {compact: true, comfortable: false, comfortableProse: false},
			"comfortable > compact": {compact: true, comfortable: false, comfortableProse: false},
			"compact > comfortable": {compact: false, comfortable: true, comfortableProse: true},
			"comfortable > compact > comfortable": {compact: false, comfortable: true, comfortableProse: true},
			"compact > comfortable > compact": {compact: true, comfortable: false, comfortableProse: false},
			"comfortable > compact > comfortable > compact": {
				compact: true,
				comfortable: false,
				comfortableProse: false,
			},
			"compact > comfortable > compact > comfortable": {
				compact: false,
				comfortable: true,
				comfortableProse: true,
			},
		});
	});
});
