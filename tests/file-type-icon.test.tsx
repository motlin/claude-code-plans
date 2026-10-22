// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {join} from "node:path";
import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {fileTypeIconsCss} from "../scripts/gen-file-type-icons-css";
import {FileTypeIcon} from "../src/components/file-type-icon";

afterEach(cleanup);

function iconSvg(container: HTMLElement): SVGSVGElement | null {
	return container.querySelector<SVGSVGElement>("svg[data-file-type-icon]");
}

function describeSvg(svg: SVGSVGElement) {
	return {
		ariaHidden: svg.getAttribute("aria-hidden"),
		viewBox: svg.getAttribute("viewBox"),
		fill: svg.getAttribute("fill"),
		className: svg.getAttribute("class"),
		width: svg.style.width,
		height: svg.style.height,
		paths: [...svg.querySelectorAll("path")].map((path) => ({
			fill: path.getAttribute("fill"),
			opacity: path.getAttribute("opacity"),
		})),
	};
}

describe("FileTypeIcon", () => {
	it("draws README.md at xs with the markdown palette variable", () => {
		const {container} = render(<FileTypeIcon fileName="docs/README.md" size="xs" className="text-ink-muted" />);
		const svg = iconSvg(container);
		expect(svg && describeSvg(svg)).toEqual({
			ariaHidden: "true",
			viewBox: "0 0 16 16",
			fill: "none",
			className: "shrink-0 text-ink-muted",
			width: "12px",
			height: "12px",
			paths: [
				{fill: "var(--fti-markdown)", opacity: ".4"},
				{fill: "var(--fti-markdown)", opacity: null},
			],
		});
		expect(container.querySelectorAll("svg")).toHaveLength(1);
	});

	it("keeps fill-rule and clip-rule as React-mapped attributes", () => {
		const {container} = render(<FileTypeIcon fileName="README.md" size="xs" />);
		const first = container.querySelector("path");
		expect({
			fillRule: first?.getAttribute("fill-rule"),
			clipRule: first?.getAttribute("clip-rule"),
		}).toEqual({fillRule: "evenodd", clipRule: "evenodd"});
	});

	it("maps sizes sm, md and xl to 16, 20 and 28 px", () => {
		const sizes = (["sm", "md", "xl"] as const).map((size) => {
			const {container} = render(<FileTypeIcon fileName="x.ts" size={size} />);
			const svg = iconSvg(container);
			return [svg?.style.width, svg?.style.height];
		});
		expect(sizes).toEqual([
			["16px", "16px"],
			["20px", "20px"],
			["28px", "28px"],
		]);
	});

	it("draws literal currentColor fills unchanged (font has no palette)", () => {
		const {container} = render(<FileTypeIcon fileName="x.woff2" size="xs" />);
		const fills = [...container.querySelectorAll("svg[data-file-type-icon] path")].map((path) =>
			path.getAttribute("fill"),
		);
		expect(fills).toEqual(["currentColor"]);
	});

	it("draws the grey default icon for an unknown doc-like name", () => {
		const {container} = render(<FileTypeIcon fileName="notes.xyz" size="xs" />);
		const svg = iconSvg(container);
		expect(svg && describeSvg(svg).paths).toEqual([
			{fill: "var(--fti-default)", opacity: ".4"},
			{fill: "var(--fti-default)", opacity: null},
		]);
	});

	it("draws a monochrome lucide glyph for an unresolved code file", () => {
		const {container} = render(<FileTypeIcon fileName="Main.java" size="xs" className="text-ink-muted" />);
		const svg = container.querySelector("svg");
		expect({
			coloured: iconSvg(container) !== null,
			className: svg?.getAttribute("class"),
			width: svg?.style.width,
			height: svg?.style.height,
		}).toEqual({
			coloured: false,
			className: "lucide lucide-file-code shrink-0 text-ink-muted",
			width: "12px",
			height: "12px",
		});
	});

	it("picks the lucide stand-in per glyph kind", () => {
		const classes = ["data.parquet", "a/SKILL.md.bak", "x.mermaid"].map((name) => {
			const {container} = render(<FileTypeIcon fileName={name} size="xs" />);
			return container.querySelector("svg")?.getAttribute("class");
		});
		expect(classes).toEqual([
			"lucide lucide-database shrink-0",
			"lucide lucide-scroll-text shrink-0",
			"lucide lucide-file-image shrink-0",
		]);
	});

	it("renders the fallback instead of a stand-in glyph when given", () => {
		const {container} = render(<FileTypeIcon fileName="Main.java" size="xs" fallback={<span data-x="" />} />);
		expect(container.innerHTML).toBe('<span data-x=""></span>');
	});

	it("ignores the fallback when a coloured icon resolves", () => {
		const {container} = render(<FileTypeIcon fileName="x.ts" size="xs" fallback={<span data-x="" />} />);
		expect({
			coloured: iconSvg(container) !== null,
			fallback: container.querySelector("[data-x]") !== null,
		}).toEqual({coloured: true, fallback: false});
	});
});

describe("file-type-icons.css", () => {
	const css = readFileSync(join(import.meta.dirname, "../src/styles/file-type-icons.css"), "utf8");

	it("matches the generator output", () => {
		expect(css).toBe(fileTypeIconsCss());
	});

	it("defines light values on :root and dark values under .dark", () => {
		const [light, dark] = css.split(".dark {");
		expect({
			lightMarkdown: light?.includes("--fti-markdown: #199f43;"),
			darkMarkdown: dark?.includes("--fti-markdown: #5ecc71;"),
			lightDefault: light?.includes("--fti-default: #84848a;"),
			darkDefault: dark?.includes("--fti-default: #adadb1;"),
			paletteEntries: css.match(/--fti-[\w-]+:/g)?.length,
		}).toEqual({
			lightMarkdown: true,
			darkMarkdown: true,
			lightDefault: true,
			darkDefault: true,
			paletteEntries: 102,
		});
	});

	it("is imported from globals.css", () => {
		const globals = readFileSync(join(import.meta.dirname, "../src/styles/globals.css"), "utf8");
		expect(globals).toContain('@import "./file-type-icons.css";');
	});
});
