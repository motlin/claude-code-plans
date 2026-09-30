import {describe, expect, it} from "vite-plus/test";
import {markdownCss, ruleDeclarations} from "./markdown-css";

describe("inline code chip", () => {
	it("inks the chip red at 0.9em/600 on a 5% tint like the cds-era upstream prose chip", () => {
		expect(ruleDeclarations(markdownCss, ".markdown code")).toStrictEqual({
			"font-family": "var(--font-mono)",
			"font-size": "0.9em",
			"font-weight": "600",
			"line-height": "18.2px",
			background: "var(--color-alpha-1)",
			border: "none",
			color: "var(--color-code-ink)",
			"border-radius": "var(--radius-r4)",
			padding: "0.06em 0.25em",
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
