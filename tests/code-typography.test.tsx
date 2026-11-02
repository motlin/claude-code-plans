// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {DIFFS_STYLE_OVERRIDES} from "../src/components/changes/diffs-config";
import {EditRenderer} from "../src/components/tool-renderers/edit-renderer";
import {ReadRenderer} from "../src/components/tool-renderers/read-renderer";
import {WriteRenderer} from "../src/components/tool-renderers/write-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";
import {compileAll} from "./helpers/tailwind-design-system";
import {ruleStart} from "./css-rule";

vi.mock("../src/components/tool-renderers/inline-diff", () => (
{
	InlineDiff: () => <div data-testid="diff-view" />,
}));

vi.mock("../src/hooks/use-shiki", () => (
{
	useHighlightedLines: () => null,
}));

function toolCall(name: string, input: Record<string, unknown>, result?: string): ClientToolCall
{
	return {
		id: "tool-call-100",
		name,
		input,
		param: "",
		result,
		sourceUuid: "source-100",
	};
}

function customProperty(styles: string, name: string): string
{
	const match = styles.match(new RegExp(`${name}:\\s*([^;]+);`));
	if (!match?.[1]) throw new Error(`Missing ${name}`);
	return match[1].trim();
}

afterEach(cleanup);

describe("code typography", () =>
{
	it("pins the upstream comfortable code font size and line height tokens (compact lives in density-tokens.test.ts)", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");

		expect(
			{
				fontSize: customProperty(styles, "--upstream-text-code"),
				lineHeight: customProperty(styles, "--upstream-leading-code"),
			},
		).toStrictEqual(
			{
				fontSize: "13px",
				lineHeight: "19px",
			},
		);
	});

	it("compiles text-code and text-code-medium in the mono face like upstream's .text-code family", async () =>
	{
		expect(await compileAll(["text-code", "text-code-medium"])).toStrictEqual(
			{
				"text-code":
					".text-code { font-family: var(--font-mono); font-feature-settings: var(--font-mono--font-feature-settings); font-size: var(--upstream-text-code); line-height: var(--tw-leading, var(--upstream-leading-code)); }",
				"text-code-medium":
					".text-code-medium { font-family: var(--font-mono); font-feature-settings: var(--font-mono--font-feature-settings); font-size: var(--text-code); line-height: var(--text-code--line-height); font-weight: 500; }",
			},
		);
	});

	it("compiles a user code span's text-danger to upstream's danger ink (#a42528 light, #f17778 dark)", async () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const dangers = [...styles.matchAll(/--upstream-text-danger:\s*([^;]+);/g)].map((match) => match[1]);

		expect(
			{
				css: await compileAll(["text-danger"]),
				dangers,
			},
		).toStrictEqual(
			{
				css:
				{
					"text-danger": ".text-danger { color: var(--upstream-text-danger); }",
				},
				dangers: ["#a42528", "#f17778"],
			},
		);
	});

	// Upstream scopes Settings ▸ Code font size to four hook classes under html[data-code-font-size], and
	// exempts document prose and approval cards ([data-fixed-code-size]), so chrome text-code stays fixed.
	it("scopes the Code font size override to upstream's hook classes and exempts documents and approval cards", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8").replace(/\s+/g, " ");

		expect(
			{
				scoped: styles.includes(
					"[data-code-font-size] :is(.epitaxy-code-size, .epitaxy-codeblock, .epitaxy-diff, .epitaxy-terminal-view) { --upstream-text-code: var(--epitaxy-code-font-size); --upstream-leading-code: var(--epitaxy-code-leading); --code-size: var(--epitaxy-code-font-size); --code-leading: var(--epitaxy-code-leading); }",
				),
				exempt: styles.includes(
					"[data-code-font-size] :is(.epitaxy-document-prose, [data-fixed-code-size]) :is(.epitaxy-code-size, .epitaxy-codeblock, .epitaxy-diff) { --upstream-text-code: inherit; --upstream-leading-code: inherit; --code-size: initial; --code-leading: initial; }",
				),
				globalFallback: styles.includes("var(--epitaxy-code-font-size,"),
				// Files pane rows: 11/13/16/20 px → 17/20/24/30 px lines.
				fileRows: styles.includes(
					"[data-code-font-size] .epitaxy-file-rows { font-size: var(--code-size); line-height: round(calc(var(--code-size) * 1.5 + 0.01px), 1px); }",
				),
			},
		).toStrictEqual(
			{
				scoped: true,
				exempt: true,
				globalFallback: false,
				fileRows: true,
			},
		);
	});

	it("matches upstream's exemption selector on hook classes inside approval cards and document prose only", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const exemption = styles.match(/(\[data-code-font-size\]\s*:is\(\.epitaxy-document-prose[^{]+)\{/)?.[1]?.trim();
		if (exemption === undefined) throw new Error("Missing exemption rule");
		const {container} = render(
			<div data-code-font-size="20">
				<div data-fixed-code-size="">
					<div data-testid="card" className="epitaxy-code-size" />
				</div>
				<div className="epitaxy-document-prose">
					<div data-testid="document" className="epitaxy-codeblock" />
				</div>
				<div data-testid="transcript" className="epitaxy-diff" />
			</div>,
		);
		const matches = (testId: string) => container.querySelector(`[data-testid=${testId}]`)?.matches(exemption);

		expect(
			{
				card: matches("card"),
				document: matches("document"),
				transcript: matches("transcript"),
			},
		).toStrictEqual(
			{
				card: true,
				document: true,
				transcript: false,
			},
		);
	});

	it("pins the upstream red inline-code ink in both themes", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const dark = styles.slice(ruleStart(styles, ".dark"));

		expect(
			{
				theme: customProperty(styles, "--color-code-ink"),
				light: customProperty(styles, "--upstream-code-ink"),
				dark: customProperty(dark, "--upstream-code-ink"),
			},
		).toStrictEqual(
			{
				theme: "var(--upstream-code-ink)",
				light: "rgb(142 38 38)",
				dark: "#ec7e7e",
			},
		);
	});

	it("uses system monospace fallbacks with ligatures disabled for --font-mono", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");

		expect(
			{
				stack: customProperty(styles, "--font-mono"),
				features: customProperty(styles, "--font-mono--font-feature-settings"),
			},
		).toStrictEqual(
			{
				stack: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
				features: '"liga" 0, "calt" 0',
			},
		);
	});

	it("turns Inter's contextual alternates off for sans text, so '->' stays two characters as in upstream's font", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");

		expect(customProperty(styles, "--font-sans--font-feature-settings")).toBe('"calt" 0');
	});

	it("turns ligatures off for every code, pre and font-mono element, but not inside diffs", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const selector = "code,\n\tkbd,\n\tsamp,\n\tpre,\n\t.font-mono\n\t{";
		const start = styles.indexOf(selector);
		if (start === -1) throw new Error("missing ligature rule");
		const rule = styles.slice(start + selector.length, styles.indexOf("}", start));

		expect(
			{
				ligatures: customProperty(rule, "font-variant-ligatures"),
				features: customProperty(rule, "font-feature-settings").replace(/\s+/g, " "),
				diffs: (DIFFS_STYLE_OVERRIDES as Record<string, string>)["--diffs-font-features"],
			},
		).toStrictEqual(
			{
				ligatures: "none",
				features: '"liga" 0, "calt" 0',
				// Diffs follow upstream's injected Aa fallback ("liga","clig","calt") instead.
				diffs: undefined,
			},
		);
	});

	it("renders write and edit diffs with the code type token", () =>
	{
		render(
			<WriteRenderer
				toolCall={toolCall(
					"Write",
					{
						file_path: "/test/alice.ts",
						content: "const alice = 100;",
					},
				)}
			/>,
		);
		render(
			<EditRenderer
				toolCall={toolCall(
					"Edit",
					{
						file_path: "/test/alice.ts",
						old_string: "const alice = 100;",
						new_string: "const alice = 200;",
					},
				)}
			/>,
		);

		expect(
			{
				fontSize: (DIFFS_STYLE_OVERRIDES as Record<string, string>)["--diffs-font-size"],
				wrappers: screen.getAllByTestId("diff-view").map((element) => element.parentElement?.className),
			},
		).toStrictEqual(
			{
				fontSize: "var(--upstream-text-code)",
				wrappers: ["max-h-[400px] overflow-y-auto text-code", "max-h-[400px] overflow-y-auto text-code"],
			},
		);
	});

	it("sizes read rows from the code line-height token and font-relative padding", () =>
	{
		const {container} = render(
			<ReadRenderer
				toolCall={toolCall(
					"Read",
					{
						file_path: "/test/alice.ts",
					},
					"1→const alice = 100;",
				)}
			/>,
		);
		const gutterRow = container.querySelector("[data-gutter]");
		const contentRow = container.querySelector("[data-content]");

		expect(
			{
				gutter:
				{
					className: gutterRow?.className,
					padding: (gutterRow as HTMLElement | null)?.style.padding,
				},
				content:
				{
					className: contentRow?.className,
					padding: (contentRow as HTMLElement | null)?.style.padding,
				},
			},
		).toStrictEqual(
			{
				gutter:
				{
					className: "min-h-[var(--upstream-leading-code)] select-none text-right text-secondary",
					padding: "0px 0.6em 0px 1.2em",
				},
				content:
				{
					className: "min-h-[var(--upstream-leading-code)] min-w-0 whitespace-pre-wrap break-words",
					padding: "0px 0.6em",
				},
			},
		);
	});
});
