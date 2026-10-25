import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

/** The declarations of the rule whose selector list is exactly `selector`, one per entry. */
function declarations(selector: string): string[] | null {
	const start = styles.indexOf(`\n${selector} {`);
	if (start === -1) return null;
	const open = styles.indexOf("{", start);
	return styles
		.slice(open + 1, styles.indexOf("}", open))
		.split(";")
		.map((declaration) => declaration.trim())
		.filter((declaration) => declaration !== "");
}

describe("focus region landing ring", () => {
	it("draws upstream's overlay landing ring as an ::after inset 2px with the focus shadow", () => {
		expect({
			hideOutline: declarations(
				'[data-focus-region-landing="overlay"]:focus,\n[data-focus-region-landing="overlay"][data-focus-region-around]:focus-within,\n[data-focus-region-inside]:focus',
			),
			ring: declarations(
				'[data-focus-region-landing="overlay"]:focus::after,\n[data-focus-region-landing="overlay"][data-focus-region-around]:focus-within::after',
			),
		}).toStrictEqual({
			hideOutline: ["outline: none"],
			ring: [
				'content: ""',
				"position: absolute",
				"inset: 2px",
				"z-index: 2147483647",
				"border-radius: inherit",
				"pointer-events: none",
				"opacity: 1",
				"outline: 2px solid transparent",
				"outline-offset: -2px",
				"box-shadow: var(--focus-shadow)",
			],
		});
	});
});
