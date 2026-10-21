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
