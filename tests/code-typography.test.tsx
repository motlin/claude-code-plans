// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {DIFFS_STYLE_OVERRIDES} from "../src/components/changes/diff-file";
import {EditRenderer} from "../src/components/tool-renderers/edit-renderer";
import {ReadRenderer} from "../src/components/tool-renderers/read-renderer";
import {WriteRenderer} from "../src/components/tool-renderers/write-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";

vi.mock("../src/components/tool-renderers/inline-diff", () => ({
	InlineDiff: () => <div data-testid="diff-view" />,
}));

vi.mock("../src/hooks/use-shiki", () => ({
	useHighlightedLines: () => null,
}));

function toolCall(name: string, input: Record<string, unknown>, result?: string): ClientToolCall {
	return {
		id: "tool-call-100",
		name,
		input,
		param: "",
		result,
		sourceUuid: "source-100",
	};
}

function customProperty(styles: string, name: string): string {
	const match = styles.match(new RegExp(`${name}:\\s*([^;]+);`));
	if (!match?.[1]) throw new Error(`Missing ${name}`);
	return match[1].trim();
}

afterEach(cleanup);

describe("code typography", () => {
	it("pins the upstream code font size and line height tokens", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");

		expect({
			fontSize: customProperty(styles, "--upstream-text-code"),
			lineHeight: customProperty(styles, "--upstream-leading-code"),
		}).toStrictEqual({
			fontSize: "13px",
			lineHeight: "20px",
		});
	});

	it("pins the upstream red inline-code ink in both themes", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const dark = styles.slice(styles.indexOf(".dark {"));

		expect({
			theme: customProperty(styles, "--color-code-ink"),
			light: customProperty(styles, "--upstream-code-ink"),
			dark: customProperty(dark, "--upstream-code-ink"),
		}).toStrictEqual({
			theme: "var(--upstream-code-ink)",
			light: "rgb(142 38 38)",
			dark: "var(--danger-000)",
		});
	});

	it("uses system monospace fallbacks with ligatures disabled for --font-mono", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");

		expect({
			stack: customProperty(styles, "--font-mono"),
			features: customProperty(styles, "--font-mono--font-feature-settings"),
		}).toStrictEqual({
			stack: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
			features: '"liga" 0, "calt" 0',
		});
	});

	it("turns ligatures off for every code, pre and font-mono element", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const selector = "code,\n\tkbd,\n\tsamp,\n\tpre,\n\t.font-mono {";
		const start = styles.indexOf(selector);
		if (start === -1) throw new Error("missing ligature rule");
		const rule = styles.slice(start + selector.length, styles.indexOf("}", start));

		expect({
			ligatures: customProperty(rule, "font-variant-ligatures"),
			features: customProperty(rule, "font-feature-settings").replace(/\s+/g, " "),
			diffs: (DIFFS_STYLE_OVERRIDES as Record<string, string>)["--diffs-font-features"],
		}).toStrictEqual({
			ligatures: "none",
			features: '"liga" 0, "calt" 0',
			diffs: '"liga" 0, "calt" 0',
		});
	});

	it("renders write and edit diffs with the code type token", () => {
		render(
			<WriteRenderer
				toolCall={toolCall("Write", {
					file_path: "/test/alice.ts",
					content: "const alice = 100;",
				})}
			/>,
		);
		render(
			<EditRenderer
				toolCall={toolCall("Edit", {
					file_path: "/test/alice.ts",
					old_string: "const alice = 100;",
					new_string: "const alice = 200;",
				})}
			/>,
		);

		expect({
			fontSize: (DIFFS_STYLE_OVERRIDES as Record<string, string>)["--diffs-font-size"],
			wrappers: screen.getAllByTestId("diff-view").map((element) => element.parentElement?.className),
		}).toStrictEqual({
			fontSize: "var(--upstream-text-code)",
			wrappers: ["max-h-[400px] overflow-y-auto text-code", "max-h-[400px] overflow-y-auto text-code"],
		});
	});

	it("sizes read rows from the code line-height token and font-relative padding", () => {
		const {container} = render(
			<ReadRenderer toolCall={toolCall("Read", {file_path: "/test/alice.ts"}, "1→const alice = 100;")} />,
		);
		const gutterRow = container.querySelector("[data-gutter]");
		const contentRow = container.querySelector("[data-content]");

		expect({
			gutter: {
				className: gutterRow?.className,
				padding: (gutterRow as HTMLElement | null)?.style.padding,
			},
			content: {
				className: contentRow?.className,
				padding: (contentRow as HTMLElement | null)?.style.padding,
			},
		}).toStrictEqual({
			gutter: {
				className: "min-h-[var(--upstream-leading-code)] select-none text-right text-secondary",
				padding: "0px 0.6em 0px 1.2em",
			},
			content: {
				className: "min-h-[var(--upstream-leading-code)] min-w-0 whitespace-pre-wrap break-words",
				padding: "0px 0.6em",
			},
		});
	});
});
