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
			"--sb-group-pt": "16px",
			"--sb-radius": "8px",
		});
	});
});
