import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

function block(selector: string): string {
	const start = styles.indexOf(`${selector} {`);
	if (start === -1) return "";
	return styles.slice(start, styles.indexOf("}", start));
}

function token(source: string, name: string): string | null {
	return source.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;
}

const TYPE_TOKENS = [
	"--upstream-text-body",
	"--upstream-leading-body",
	"--upstream-text-footnote",
	"--upstream-leading-footnote",
	"--upstream-text-code",
	"--upstream-leading-code",
	"--upstream-text-caption",
	"--upstream-leading-caption",
] as const;

function typeTokens(source: string): Record<string, string | null> {
	return Object.fromEntries(TYPE_TOKENS.map((name) => [name, token(source, name)]));
}

describe("density type tokens", () => {
	it("uses upstream's comfortable type scale on :root and the compact scale under [data-density=compact]", () => {
		const theme = block("@theme inline");
		const compact = block('[data-density="compact"]');

		expect({
			root: typeTokens(block(":root")),
			compact: typeTokens(compact),
			compactDeclarations: compact.match(/--[\w-]+:/g)?.length ?? 0,
			caption: token(theme, "--text-caption"),
			captionLeading: token(theme, "--text-caption--line-height"),
		}).toStrictEqual({
			root: {
				"--upstream-text-body": "14px",
				"--upstream-leading-body": "20px",
				"--upstream-text-footnote": "13px",
				"--upstream-leading-footnote": "17px",
				"--upstream-text-code": "13px",
				"--upstream-leading-code": "19px",
				"--upstream-text-caption": "12px",
				"--upstream-leading-caption": "17px",
			},
			compact: {
				"--upstream-text-body": "13px",
				"--upstream-leading-body": "19px",
				"--upstream-text-footnote": "12px",
				"--upstream-leading-footnote": "15px",
				"--upstream-text-code": "12px",
				"--upstream-leading-code": "17px",
				"--upstream-text-caption": "11px",
				"--upstream-leading-caption": "17px",
			},
			compactDeclarations: 8,
			caption: "var(--upstream-text-caption)",
			captionLeading: "var(--upstream-leading-caption)",
		});
	});
});

describe("density sidebar geometry", () => {
	// Upstream `Us()` defaults the web sidebar to comfortable; the 26px compact rows are the desktop app's default only.
	it("locks the web sidebar geometry tokens on :root at upstream's comfortable values", () => {
		const root = block(":root");
		const names = [
			"--sb-row-h",
			"--sb-row-font",
			"--sb-group-font",
			"--sb-icon",
			"--sb-leading-slot",
			"--sb-row-ctl",
			"--sb-row-gap",
			"--sb-group-pt",
			"--sb-radius",
		];

		expect(Object.fromEntries(names.map((name) => [name, token(root, name)]))).toStrictEqual({
			"--sb-row-h": "32px",
			"--sb-row-font": "14px",
			"--sb-group-font": "13px",
			"--sb-icon": "20px",
			"--sb-leading-slot": "28px",
			"--sb-row-ctl": "24px",
			"--sb-row-gap": "8px",
			"--sb-group-pt": "0px",
			"--sb-radius": "8px",
		});
	});

	it("bands desktop group labels with upstream's df-session-list tokens: 8px + row-height band, 2px stack, 8px iconless pad", () => {
		const root = block(":root");
		const names = [
			"--sb-row-stack-gap",
			"--sb-group-band-mt",
			"--sb-group-band-h",
			"--sb-group-pt",
			"--sb-group-label-pb",
			"--sb-group-pb",
			"--sb-iconless-pad",
		];

		expect(Object.fromEntries(names.map((name) => [name, token(root, name)]))).toStrictEqual({
			"--sb-row-stack-gap": "2px",
			"--sb-group-band-mt": "calc(10px - var(--sb-row-stack-gap))",
			"--sb-group-band-h": "var(--sb-row-h)",
			"--sb-group-pt": "0px",
			"--sb-group-label-pb": "0px",
			"--sb-group-pb": "var(--sb-row-stack-gap)",
			"--sb-iconless-pad": "8px",
		});
	});

	it("insets group labels by the row padding plus upstream's iconless pad (10px), as .df-label-inset", () => {
		expect(token(block("\n.df-label-inset").replaceAll(/\s+/g, " "), "padding-left")).toBe(
			"calc(var(--sb-row-px) + var(--sb-iconless-pad, calc((var(--sb-leading-slot) - var(--sb-icon)) / 2)))",
		);
	});
});

describe("described session rows", () => {
	function declarations(selector: string): Record<string, string> {
		return Object.fromEntries(
			[
				...block(`\n${selector}`)
					.slice(selector.length + 3)
					.matchAll(/([\w-]+):\s*([^;]+);/g),
			].map((match) => [match[1], match[2]?.replaceAll(/\s+/g, " ").replace("( ", "(").replace(" )", ")")]),
		);
	}

	it("adds upstream's described tuck/trim tokens on :root and the 24px described line on the phone sheet", () => {
		const root = block(":root");
		const sheet = block("\n.phone-sheet");
		expect({
			tuck: token(root, "--sb-described-tuck"),
			trim: token(root, "--sb-described-trim"),
			rootLine: token(root, "--sb-described-line"),
			phoneLine: token(sheet, "--sb-described-line"),
		}).toStrictEqual({
			tuck: "4px",
			trim: "calc(var(--sb-described-tuck) / 2)",
			rootLine: null,
			phoneLine: "24px",
		});
	});

	it("copies upstream's .df-described-row, .df-row-description and .df-meta-line rules", () => {
		expect({
			row: declarations(".df-described-row"),
			lines: declarations(".df-described-title,\n.df-row-description"),
			description: declarations(".df-row-description"),
			metaLine: declarations(".df-meta-line"),
			metaLineRtl: declarations('.df-meta-line:where(:root[dir="rtl"] :dir(rtl))'),
		}).toStrictEqual({
			row: {
				"padding-block":
					"calc((var(--sb-row-h) - var(--sb-described-line, var(--sb-row-ctl))) / 2 + var(--sb-described-tuck) - var(--sb-described-trim))",
				"row-gap": "2px",
			},
			lines: {height: "calc(var(--sb-described-line, var(--sb-row-ctl)) - var(--sb-described-tuck))"},
			description: {"font-size": "var(--sb-group-font)", "line-height": "16px", gap: "6px"},
			metaLine: {
				overflow: "clip",
				"padding-inline-end": "12px",
				"mask-image": "linear-gradient(90deg, #000 calc(100% - 12px), transparent)",
			},
			metaLineRtl: {"mask-image": "linear-gradient(270deg, #000 calc(100% - 12px), transparent)"},
		});
	});

	it("centres a described row's decoration and kebab on the title line, as upstream's described top", () => {
		expect(declarations("[data-described] :is([data-row-decoration], [data-row-action])")).toStrictEqual({
			top: "calc(var(--sb-row-h) / 2 + var(--sb-described-tuck) / 2 - var(--sb-described-trim))",
		});
	});
});
