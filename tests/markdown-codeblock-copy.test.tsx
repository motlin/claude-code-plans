// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {cleanup, fireEvent, render} from "@testing-library/react";
import {MarkdownArticle} from "../src/components/markdown-article";
import {renderMarkdownToHtml} from "../src/lib/client-markdown";
import {markdownCss, ruleDeclarations} from "./markdown-css";

const FENCE = "```js\nconst x = 1;\n```";

describe("fenced code block copy button markup", () => {
	it("wraps every fence in a codeblock wrapper carrying one Copy code button with a tooltip", () => {
		const html = renderMarkdownToHtml(`${FENCE}\n\n\`\`\`\nplain\n\`\`\``);

		expect({
			wrappers: html.match(/class="markdown-codeblock"/g)?.length ?? 0,
			rails: html.match(/class="markdown-code-copy-rail"/g)?.length ?? 0,
			strips: html.match(/class="markdown-code-copy"/g)?.length ?? 0,
			buttons:
				html.match(/<button type="button" data-copy-code aria-label="Copy code" data-tooltip="Copy code">/g)
					?.length ?? 0,
			railFollowsPre: html.includes(
				'</code></pre><div class="markdown-code-copy-rail"><div class="markdown-code-copy">',
			),
		}).toStrictEqual({wrappers: 2, rails: 2, strips: 2, buttons: 2, railFollowsPre: true});
	});

	it("leaves inline code and prose unwrapped", () => {
		expect(renderMarkdownToHtml("a `snippet` in prose")).toBe("<p>a <code>snippet</code> in prose</p>\n");
	});

	it("draws fences as upstream's white 12/17 card at least 318px wide", () => {
		expect({
			wrapper: ruleDeclarations(markdownCss, ".markdown :global(.markdown-codeblock)"),
			pre: ruleDeclarations(markdownCss, ".markdown :global(.markdown-codeblock) > pre"),
			darkPre: ruleDeclarations(markdownCss, ":global(.dark) .markdown :global(.markdown-codeblock) > pre"),
			code: ruleDeclarations(markdownCss, ".markdown :global(.markdown-codeblock) > pre code"),
		}).toStrictEqual({
			wrapper: {
				position: "relative",
				width: "fit-content",
				"min-width": "min(100%, 318px)",
				"max-width": "100%",
			},
			pre: {
				margin: "0",
				width: "auto",
				"font-size": "12px",
				"line-height": "17px",
				background: "var(--color-surface-1)",
				"border-radius": "8px",
				padding: "8px 45.2px 8px 17.2px",
			},
			darkPre: {background: "var(--color-surface-1)"},
			code: {"line-height": "17px"},
		});
	});

	it("pins an always-visible strip to the card's top-right corner while a tall block scrolls", () => {
		expect({
			rail: ruleDeclarations(markdownCss, ".markdown :global(.markdown-code-copy-rail)"),
			strip: ruleDeclarations(markdownCss, ".markdown :global(.markdown-code-copy)"),
			hidesStrip: /markdown-code-copy[^{]*\{[^}]*opacity:\s*0/.test(markdownCss),
		}).toStrictEqual({
			rail: {
				position: "absolute",
				top: "0",
				right: "7px",
				bottom: "0",
				"pointer-events": "none",
			},
			strip: {
				position: "sticky",
				top: "calc(max(var(--fade-top, 0px), 0px) + 5px)",
				"margin-top": "5px",
				display: "flex",
				gap: "3px",
				"pointer-events": "auto",
			},
			hidesStrip: false,
		});
	});

	it("sizes the button like upstream: 24px square, radius 6, 16px icon", () => {
		expect({
			button: ruleDeclarations(markdownCss, ".markdown :global(.markdown-code-copy) button"),
			icon: ruleDeclarations(markdownCss, ".markdown :global(.markdown-code-copy) button svg"),
		}).toStrictEqual({
			button: {
				position: "relative",
				display: "inline-flex",
				"align-items": "center",
				"justify-content": "center",
				width: "24px",
				height: "24px",
				padding: "0",
				border: "0",
				"border-radius": "6px",
				background: "transparent",
				color: "var(--color-t6)",
				cursor: "pointer",
			},
			icon: {width: "16px", height: "16px"},
		});
	});

	it("shows a dark tooltip matching ui/tooltip.tsx after the 300ms open delay", () => {
		const tooltip = ".markdown :global(.markdown-code-copy) button[data-tooltip]::after";
		const shown =
			".markdown :global(.markdown-code-copy) button[data-tooltip]:hover::after,\n.markdown :global(.markdown-code-copy) button[data-tooltip]:focus-visible::after";

		expect({
			tooltip: ruleDeclarations(markdownCss, tooltip),
			shown: ruleDeclarations(markdownCss, shown),
		}).toStrictEqual({
			tooltip: {
				content: "attr(data-tooltip)",
				position: "absolute",
				bottom: "calc(100% + 4px)",
				left: "50%",
				translate: "-50% 0",
				"z-index": "50",
				display: "inline-flex",
				"align-items": "center",
				"min-height": "24px",
				padding: "3px 8px",
				"border-radius": "var(--radius-r5)",
				background: "var(--tooltip-bg)",
				color: "var(--tooltip-fg)",
				"font-family": "var(--font-sans)",
				"font-size": "13px",
				"line-height": "18px",
				"white-space": "nowrap",
				"box-shadow": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
				"pointer-events": "none",
				visibility: "hidden",
			},
			shown: {visibility: "visible", "transition-delay": "300ms"},
		});
	});
});

describe("fenced code block copy button behaviour", () => {
	afterEach(cleanup);

	function renderWithClipboard(markdown: string) {
		const writeText = vi.fn(() => Promise.resolve());
		Object.defineProperty(navigator, "clipboard", {
			value: {writeText},
			configurable: true,
		});
		return {writeText, container: render(<MarkdownArticle markdown={markdown} />).container};
	}

	it("copies the code block's text when its button is clicked", () => {
		const {writeText, container} = renderWithClipboard(FENCE);

		fireEvent.click(container.querySelector("[data-copy-code]")!);

		expect(writeText.mock.calls).toStrictEqual([["const x = 1;\n"]]);
	});

	it("copies the code of the block whose button was clicked", () => {
		const {writeText, container} = renderWithClipboard("```\nfirst\n```\n\n```\nsecond\n```");

		fireEvent.click(container.querySelectorAll("[data-copy-code]")[1]!);

		expect(writeText.mock.calls).toStrictEqual([["second\n"]]);
	});

	it("ignores clicks on the code itself", () => {
		const {writeText, container} = renderWithClipboard(FENCE);

		fireEvent.click(container.querySelector("pre")!);

		expect(writeText.mock.calls).toStrictEqual([]);
	});
});
