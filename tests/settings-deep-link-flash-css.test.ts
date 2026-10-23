import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8").replaceAll(/\s+/g, " ");

const WAVE =
	"url(\"data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'8'%20height%3D'5'%3E%3Cpath%20d%3D'M0%202.5%20Q2%200.75%204%202.5%20Q6%204.25%208%202.5'%20fill%3D'none'%20stroke%3D'black'%20stroke-width%3D'1.3'%20stroke-linecap%3D'round'%2F%3E%3C%2Fsvg%3E\")";

function missing(rules: readonly string[]): string[] {
	return rules.filter((rule) => !styles.includes(rule));
}

describe("settings deep-link flash CSS", () => {
	it("copies upstream's row wash and wavy title underline", () => {
		expect(
			missing([
				".feature-anchor-row-fill { isolation: isolate; position: relative; }",
				'.feature-anchor-row-fill::before { content: ""; background: color-mix(in srgb, #fab219 22%, transparent); pointer-events: none; z-index: -1; opacity: 0; border-radius: 6px; animation: 1.95s ease-out 0s 1 normal forwards running feature-anchor-row-fill-wash; position: absolute; inset: 4px -4px; }',
				".feature-anchor-highlight { position: relative; }",
				`.feature-anchor-highlight::after { content: ""; background: #fab219; pointer-events: none; clip-path: inset(0px 100% 0px 0px); height: 5px; animation: 1.95s ease-out 0s 1 normal forwards running feature-anchor-highlight-underline; position: absolute; bottom: -4px; left: 0px; right: 0px; mask-image: ${WAVE}; mask-size: 8px 5px; mask-repeat: repeat-x; }`,
				"@keyframes feature-anchor-highlight-underline { 0% { clip-path: inset(0px 100% 0px 0px); opacity: 1; } 17.9% { clip-path: inset(0px); opacity: 1; } 53.8% { clip-path: inset(0px); opacity: 1; } 100% { clip-path: inset(0px); opacity: 0; } }",
				"@keyframes feature-anchor-row-fill-wash { 0% { opacity: 0; } 17.9% { opacity: 1; } 53.8% { opacity: 1; } 100% { opacity: 0; } }",
			]),
		).toStrictEqual([]);
	});

	it("shows both static under the OS reduced-motion preference and the Motion: Reduced setting", () => {
		expect(
			missing([
				"@media (prefers-reduced-motion: reduce) { .feature-anchor-highlight::after { clip-path: inset(0px); opacity: 1; animation: none; } .feature-anchor-row-fill::before { opacity: 1; animation: none; } }",
				'html[data-motion="reduced"] .feature-anchor-highlight::after { clip-path: inset(0px); opacity: 1; animation: none; }',
				'html[data-motion="reduced"] .feature-anchor-row-fill::before { opacity: 1; animation: none; }',
			]),
		).toStrictEqual([]);
	});

	it("drops the old straight-underline flash", () => {
		expect(["settings-row-flash", "data-settings-flash"].filter((name) => styles.includes(name))).toStrictEqual([]);
	});
});
