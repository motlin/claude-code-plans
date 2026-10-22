import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.tsx?$/.test(name) ? [path] : [];
	});
}

describe("focus rings", () => {
	it("rings rows and buttons only on keyboard focus, as upstream's focus-visible rings do", () => {
		const offenders = sources("src").filter((path) =>
			/(?<![\w-])focus:ring-focus\b/.test(readFileSync(path, "utf8")),
		);

		expect({
			offenders,
			fileResult: readFileSync("src/components/file-search-results.tsx", "utf8").includes(
				"hover:bg-surface-0/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100",
			),
		}).toStrictEqual({offenders: [], fileResult: true});
	});
});

describe("upstream base focus ring", () => {
	const css = readFileSync("src/styles/globals.css", "utf8");

	it("keeps hide-focus-ring as a pure opt-out marker with no rules of its own", () => {
		expect(/\.hide-focus-ring\s*[{,]/.test(css)).toBe(false);
	});

	it("rings bare links, buttons and fields on focus-visible unless they opt out", () => {
		const base = css.slice(css.indexOf("@layer base {"));
		const match = base.match(
			/(a:not\(\[role="menuitem"\]\):not\(\.hide-focus-ring\):focus-visible,\s*button:not\(\[role="menuitem"\]\):not\(\.hide-focus-ring\):focus-visible,\s*input:not\(\.hide-focus-ring\):not\(\.cds-input\):focus-visible,\s*textarea:not\(\.hide-focus-ring\):not\(\.cds-input\):focus-visible,\s*\.can-focus:focus-visible,\s*\.can-focus-within:focus-within)\s*\{([^}]*)\}/,
		);
		expect(
			match?.[2]
				?.split(";")
				.map((d) => d.trim())
				.filter(Boolean),
		).toStrictEqual([
			"outline: 2px solid var(--focus-outline-color)",
			"outline-offset: 2px",
			"transition: outline 0.2s !important",
		]);
	});

	it("colours the base ring with upstream --accent-100 in light and dark", () => {
		expect([...css.matchAll(/--focus-outline-color:\s*([^;]+);/g)].map((m) => m[1])).toStrictEqual([
			"hsl(213.117 67.5439% 44.7059%)",
			"hsl(212.466 75.2577% 61.9608%)",
		]);
	});

	it("draws ring-focus as upstream's shadow-focus box-shadow", () => {
		const body = css.match(/@utility ring-focus\s*\{([^}]*)\}/)?.[1];
		expect(
			body
				?.split(";")
				.map((d) => d.trim())
				.filter(Boolean),
		).toStrictEqual(["box-shadow: var(--focus-shadow)", "outline-style: none"]);
	});
});

describe("upstream focus shadow tokens", () => {
	const css = readFileSync("src/styles/globals.css", "utf8");
	const values = (name: string) => [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g"))].map((m) => m[1]);

	it("defines --focus-shadow and --focus-shadow-danger with upstream's inner page ring in light and dark", () => {
		expect({
			focus: values("--focus-shadow"),
			danger: values("--focus-shadow-danger"),
			utility: values("--shadow-focus-danger"),
		}).toStrictEqual({
			focus: [
				"inset 0 0 0 1px #fcfcfb, 0 0 0 1px #2a78d6, 0 0 6px 1px #cde2fb",
				"inset 0 0 0 1px var(--upstream-page), 0 0 0 1px #2a78d6, 0 0 6px 1px rgb(24 79 149 / 0.6)",
			],
			danger: [
				"inset 0 0 0 1px #fcfcfb, 0 0 0 1px #d03b3b, 0 0 6px 1px #fad6d6",
				"inset 0 0 0 1px var(--upstream-page), 0 0 0 1px #d03b3b, 0 0 6px 1px rgb(142 38 38 / 0.6)",
			],
			utility: ["var(--focus-shadow-danger)"],
		});
	});
});
