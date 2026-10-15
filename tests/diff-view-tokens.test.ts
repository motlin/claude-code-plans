import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {DIFFS_STYLE_OVERRIDES, INLINE_DIFFS_STYLE_OVERRIDES} from "../src/components/changes/diffs-config";

const ROOT = resolve(__dirname, "..");
const GLOBALS_CSS = resolve(ROOT, "src", "styles", "globals.css");

const OVERRIDES = DIFFS_STYLE_OVERRIDES as Record<string, string>;

/** The tokens a top-level block (`@theme`, `@theme inline`, `:root`, `.dark`) of globals.css defines. */
function tokensDefinedIn(css: string, selector: string): Set<string> {
	const start = css.indexOf(`\n${selector} {`);
	if (start === -1) throw new Error(`block not found: ${selector}`);
	const block = css.slice(start, css.indexOf("\n}", start + 1));
	return new Set([...block.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1]!));
}

/** Every custom property the overrides read through `var(...)`. */
function referencedTokens(): string[] {
	const tokens = new Set<string>();
	for (const value of Object.values(OVERRIDES)) {
		for (const match of value.matchAll(/var\((--[\w-]+)\)/g)) tokens.add(match[1]!);
	}
	return [...tokens].toSorted();
}

describe("diff view tokens", () => {
	it("reads only tokens that both themes resolve, so one override set covers light and dark", () => {
		const css = readFileSync(GLOBALS_CSS, "utf8");
		const shared = new Set([...tokensDefinedIn(css, "@theme"), ...tokensDefinedIn(css, "@theme inline")]);
		const root = tokensDefinedIn(css, ":root");
		const dark = tokensDefinedIn(css, ".dark");

		expect(
			referencedTokens().filter((token) => !shared.has(token) && !(root.has(token) && dark.has(token))),
		).toStrictEqual(
			// Theme-independent sizes live only in :root; .dark inherits them.
			["--upstream-leading-code", "--upstream-text-code"],
		);
	});

	it("paints diff rows with upstream's git tokens and code typography", () => {
		expect({
			font: OVERRIDES["--diffs-font-family"],
			size: OVERRIDES["--diffs-font-size"],
			leading: OVERRIDES["--diffs-line-height"],
			addition: OVERRIDES["--diffs-addition-color-override"],
			deletion: OVERRIDES["--diffs-deletion-color-override"],
		}).toStrictEqual({
			font: "var(--font-mono)",
			size: "var(--upstream-text-code)",
			leading: "var(--upstream-leading-code)",
			addition: "var(--upstream-git-added)",
			deletion: "var(--upstream-git-removed)",
		});
	});

	it("defines upstream's git added/removed inks per theme, and the transcript's inline diffs at 12/17", () => {
		const css = readFileSync(GLOBALS_CSS, "utf8");
		const token = (selector: string, name: string) => {
			const start = css.indexOf(`\n${selector} {`);
			return css.slice(start, css.indexOf("\n}", start + 1)).match(new RegExp(`\\s${name}:\\s*([^;]+);`))?.[1];
		};
		const inline = INLINE_DIFFS_STYLE_OVERRIDES as Record<string, string>;

		expect({
			light: [token(":root", "--upstream-git-added"), token(":root", "--upstream-git-removed")],
			dark: [token(".dark", "--upstream-git-added"), token(".dark", "--upstream-git-removed")],
			theme: [token("@theme inline", "--color-diff-added"), token("@theme inline", "--color-diff-removed")],
			numbers: [
				OVERRIDES["--diffs-fg-number-addition-override"],
				OVERRIDES["--diffs-fg-number-deletion-override"],
			],
			inline: [
				inline["--diffs-font-size"],
				inline["--diffs-line-height"],
				inline["--diffs-addition-color-override"],
			],
		}).toStrictEqual({
			light: ["#1e9e3c", "#cd2054"],
			dark: ["#32d74b", "#ff2c56"],
			theme: ["var(--upstream-git-added)", "var(--upstream-git-removed)"],
			numbers: ["var(--upstream-git-added)", "var(--upstream-git-removed)"],
			inline: ["12px", "17px", "var(--upstream-git-added)"],
		});
	});

	it("renders every diff with @pierre/diffs, leaving no @git-diff-view styles or dependency", () => {
		const css = readFileSync(GLOBALS_CSS, "utf8");
		const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
			dependencies: Record<string, string>;
		};

		expect({
			cssRules: css.includes(".diff-tailwindcss-wrapper"),
			dependencies: Object.keys(pkg.dependencies).filter((name) => name.startsWith("@git-diff-view/")),
			pierre: "@pierre/diffs" in pkg.dependencies,
		}).toStrictEqual({cssRules: false, dependencies: [], pierre: true});
	});
});
