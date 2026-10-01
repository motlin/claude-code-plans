import {describe, expect, it} from "vite-plus/test";
import {markdownCss, ruleDeclarations} from "./markdown-css";

describe("inline code chip", () => {
	it("inks a leading-none 0.9em/400 chip red on a 5% tint like the upstream prose chip", () => {
		expect(ruleDeclarations(markdownCss, ".markdown code")).toStrictEqual({
			"font-family": "var(--font-mono)",
			"font-size": "0.9em",
			"font-weight": "400",
			"line-height": "1",
			background: "var(--color-alpha-1)",
			border: "none",
			color: "var(--color-code-ink)",
			"border-radius": "0.4em",
			padding: "0.0625em 0.25em",
		});
	});

	it("leaves dark mode to the themed tokens instead of a hard-coded override", () => {
		expect(markdownCss.includes(":global(.dark) .markdown code")).toBe(false);
	});

	it("keeps fenced code at the 20px code line-height the tightened chip would otherwise steal", () => {
		expect(ruleDeclarations(markdownCss, ".markdown pre code")).toStrictEqual({
			background: "none",
			border: "none",
			color: "inherit",
			padding: "0",
			"font-weight": "400",
			"line-height": "20px",
			"border-radius": "0",
		});
	});
});
