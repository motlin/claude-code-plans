import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {ruleDeclarations} from "./markdown-css";

const css = readFileSync(resolve(__dirname, "..", "src", "styles", "globals.css"), "utf8");

const ease = "var(--df-ease-out-cubic)";

describe("upstream shared-styles .dframe-drop-overlay-badge", () =>
{
	it("defines --df-ease-out-cubic on :root", () =>
	{
		expect(css).toContain("--df-ease-out-cubic: cubic-bezier(0.215, 0.61, 0.355, 1);");
	});

	it("ports the badge rule", () =>
	{
		expect(ruleDeclarations(css, ".dframe-drop-overlay-badge")).toStrictEqual(
			{
				"border-radius": "var(--df-radius-card, 8px)",
				border: "1px solid var(--color-strong)",
				background: "color-mix(in srgb, var(--color-surface-0) 40%, transparent)",
				"backdrop-filter": "blur(2px)",
				"font-variation-settings": "normal",
				"box-shadow": "inset 0 0 0 2px var(--color-fill-accent)",
				"pointer-events": "none",
				transition: `left 0.12s ${ease}, top 0.12s ${ease}, width 0.12s ${ease}, height 0.12s ${ease}, opacity 0.12s ${ease}`,
				"justify-content": "center",
				"align-items": "center",
				"font-size": "0.875rem",
				"font-weight": "500",
				display: "flex",
				position: "absolute",
			},
		);
	});

	it("swaps left for right in RTL", () =>
	{
		expect(ruleDeclarations(css, '.dframe-drop-overlay-badge:where(:root[dir="rtl"] :dir(rtl))')).toStrictEqual(
			{
				transition: `right 0.12s ${ease}, top 0.12s ${ease}, width 0.12s ${ease}, height 0.12s ${ease}, opacity 0.12s ${ease}`,
			},
		);
	});

	it("ports the ::before glow", () =>
	{
		expect(ruleDeclarations(css, ".dframe-drop-overlay-badge::before")).toStrictEqual(
			{
				content: '""',
				"border-radius": "inherit",
				"box-shadow": "inset 0 0 24px 0 color-mix(in srgb, var(--color-fill-accent) 20%, transparent)",
				"pointer-events": "none",
				position: "absolute",
				inset: "0",
			},
		);
	});

	it("ports the label pill", () =>
	{
		expect(ruleDeclarations(css, ".dframe-drop-overlay-label")).toStrictEqual(
			{
				background: "var(--color-fill-accent)",
				color: "var(--color-gray-0)",
				transition: `background-color 0.12s ${ease}, color 0.12s ${ease}`,
				"border-radius": "9999px",
				padding: "4px 10px",
			},
		);
	});

	it("drops the transitions under reduced motion", () =>
	{
		expect(css).toContain(
			"@media (prefers-reduced-motion: reduce)\n{\n\t.dframe-drop-overlay-badge,\n\t.dframe-drop-overlay-badge::before,\n\t.dframe-drop-overlay-label\n\t{\n\t\ttransition: none;\n\t}\n}",
		);
		expect(css).toContain(
			'[data-reduce-motion="true"] .dframe-drop-overlay-badge,\n[data-reduce-motion="true"] .dframe-drop-overlay-label\n{\n\ttransition: none;\n}',
		);
	});
});
