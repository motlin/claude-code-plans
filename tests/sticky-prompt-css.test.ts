import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

/** The declarations of the last rule whose selector list is exactly `selector`, one per entry. */
function declarations(selector: string, indent = ""): string[] | null {
	const start = styles.lastIndexOf(`\n${indent}${selector} {`);
	if (start === -1) return null;
	const open = styles.indexOf("{", start);
	return styles
		.slice(open + 1, styles.indexOf("}", open))
		.split(";")
		.map((declaration) => declaration.trim())
		.filter((declaration) => declaration !== "");
}

describe("sticky prompt bubble CSS (upstream inline style c499e192a)", () => {
	it("peeks one line with the tail at the bottom, and opens to five lines on hover or focus", () => {
		expect({
			clip: declarations(".epitaxy-sticky-prompt-clip"),
			open: declarations(".epitaxy-sticky-prompt-clip:hover,\n.epitaxy-sticky-prompt-clip:focus-visible"),
			focus: declarations(".epitaxy-sticky-prompt-clip:focus-visible"),
		}).toStrictEqual({
			clip: [
				"--epitaxy-sticky-line: var(--upstream-leading-body)",
				"--epitaxy-sticky-peek: calc(var(--epitaxy-sticky-line) + var(--cds-pad-md))",
				"max-height: var(--epitaxy-sticky-peek)",
				"text-align: start",
				"border-radius: 0 0 calc(var(--upstream-radius) + 4px) calc(var(--upstream-radius) + 4px)",
				"box-shadow: var(--cds-shadow-md)",
				"outline: none",
				"flex-direction: column",
				"justify-content: flex-end",
				"transition: max-height 0.22s cubic-bezier(0.215, 0.61, 0.355, 1)",
				"display: flex",
				"overflow: hidden",
			],
			open: ["max-height: calc(var(--epitaxy-sticky-peek) + var(--epitaxy-sticky-line) * 4 + var(--cds-pad-md))"],
			focus: ["outline: 1px solid var(--cds-fill-accent)", "outline-offset: 2px"],
		});
	});

	it("paints the bubble as the user-message wash over the transcript surface, entering from above", () => {
		expect({
			bubble: declarations(".epitaxy-sticky-prompt-bubble"),
			enter: styles.includes(
				"@keyframes epitaxy-sticky-prompt-enter {\n\t0% {\n\t\ttransform: translateY(calc(-1 * var(--epitaxy-sticky-peek)));\n\t}\n\tto {\n\t\ttransform: none;\n\t}\n}",
			),
		}).toStrictEqual({
			bubble: [
				"padding: var(--cds-pad-md) var(--cds-pad-lg)",
				"border-radius: 0 0 calc(var(--upstream-radius) + 4px) calc(var(--upstream-radius) + 4px)",
				"background:\n\t\tlinear-gradient(var(--user-msg-bg), var(--user-msg-bg)),\n\t\tvar(--epitaxy-transcript-surface, var(--color-surface-1))",
				"color: var(--upstream-text-primary)",
				"font-family: var(--font-sans)",
				"font-size: var(--upstream-text-body)",
				"line-height: var(--upstream-leading-body)",
				"white-space: pre-wrap",
				"overflow-wrap: anywhere",
				"text-wrap: pretty",
				"animation: 0.22s cubic-bezier(0.215, 0.61, 0.355, 1) epitaxy-sticky-prompt-enter",
				"display: block",
			],
			enter: true,
		});
	});

	it("drops the transition and the enter animation under reduced motion", () => {
		expect({
			osClip: declarations(".epitaxy-sticky-prompt-clip", "\t"),
			osBubble: declarations(".epitaxy-sticky-prompt-bubble", "\t"),
			rootClip: declarations('[data-reduce-motion="true"] .epitaxy-sticky-prompt-clip'),
			rootBubble: declarations('[data-reduce-motion="true"] .epitaxy-sticky-prompt-bubble'),
			media: styles.includes("@media (prefers-reduced-motion: reduce) {\n\t.epitaxy-sticky-prompt-clip {"),
		}).toStrictEqual({
			osClip: ["transition: none"],
			osBubble: ["animation: none"],
			rootClip: ["transition: none"],
			rootBubble: ["animation: none"],
			media: true,
		});
	});
});
