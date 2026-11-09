// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {cleanup, fireEvent, render} from "@testing-library/react";
import {MarkdownArticle} from "../src/components/markdown-article";
import {renderMarkdownToHtml} from "../src/lib/client-markdown";
import {EYE_ICON_SVG} from "../src/lib/icon-paths";
import {markdownCss, ruleDeclarations} from "./markdown-css";

const FENCE = "```js\nconst x = 1;\n```";

describe("fenced code block copy button markup", () => {
	it("wraps every fence in a codeblock wrapper carrying one Copy code button with a tooltip", () => {
		const html = renderMarkdownToHtml(`${FENCE}\n\n\`\`\`\nplain\n\`\`\``);

		expect({
			wrappers: html.match(/class="markdown-codeblock epitaxy-codeblock"/g)?.length ?? 0,
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

	it("draws fences as upstream's white 12/17 card at least 318px wide, following Settings ▸ Code font size", () => {
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
				"font-size": "var(--code-size, 12px)",
				"line-height": "var(--code-leading, 17px)",
				background: "var(--color-surface-1)",
				"border-radius": "8px",
				padding: "8px 45.2px 8px 17.2px",
			},
			darkPre: {background: "var(--color-surface-1)"},
			code: {"line-height": "var(--code-leading, 17px)"},
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
				top: "calc(max(var(--epitaxy-top-fade-height, 0px), var(--fade-top, 0px)) + 5px)",
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
		const writeText = vi.fn<Clipboard["writeText"]>(async () => Promise.resolve());
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

describe("fenced code block secret masking", () => {
	afterEach(cleanup);

	const FAKE_GH = `ghp_${"A".repeat(36)}`;
	const MASKED_GH = `ghp_AAAA${"•".repeat(32)}`;
	const FAKE_AWS = "AKIAEXAMPLEFAKE12345";
	const SECRET_FENCE = `\`\`\`\nexport GH=${FAKE_GH}\n\`\`\``;

	function renderWithClipboard(markdown: string) {
		const writeText = vi.fn<Clipboard["writeText"]>(async () => Promise.resolve());
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
		return {writeText, container: render(<MarkdownArticle markdown={markdown} />).container};
	}

	function revealState(container: HTMLElement) {
		const button = container.querySelector("[data-reveal-secrets]")!;
		return {
			pre: container.querySelector(".markdown-codeblock > pre")!.textContent,
			pressed: button.getAttribute("aria-pressed"),
			label: button.getAttribute("aria-label"),
			tooltip: button.getAttribute("data-tooltip"),
			iconPaths: button.querySelectorAll("svg path").length,
		};
	}

	it("masks the fence text and puts a Reveal button before Copy", () => {
		const html = renderMarkdownToHtml(SECRET_FENCE);
		expect({
			strip: html.includes(
				`<div class="markdown-code-copy"><button type="button" data-reveal-secrets aria-pressed="false" aria-label="Reveal 1 secret" data-tooltip="Reveal 1 secret">${EYE_ICON_SVG}</button><button type="button" data-copy-code`,
			),
			maskedPre: html.includes(`<pre><code>export GH=${MASKED_GH}\n</code></pre>`),
			rawOnlyInTemplate: html.split(FAKE_GH).length - 1,
			template: html.includes(
				`<template data-secret-raw><pre><code>export GH=${FAKE_GH}\n</code></pre></template>`,
			),
		}).toStrictEqual({strip: true, maskedPre: true, rawOnlyInTemplate: 1, template: true});
	});

	it("counts secrets in the label", () => {
		expect(renderMarkdownToHtml(`\`\`\`\n${FAKE_GH} ${FAKE_AWS}\n\`\`\``)).toContain(
			'aria-label="Reveal 2 secrets"',
		);
	});

	it("draws no Reveal button for a fence without secrets", () => {
		expect(renderMarkdownToHtml(FENCE).includes("data-reveal-secrets")).toBe(false);
	});

	it("reveals and hides the raw text on click", () => {
		const {container} = renderWithClipboard(SECRET_FENCE);
		const masked = revealState(container);
		fireEvent.click(container.querySelector("[data-reveal-secrets]")!);
		const revealed = revealState(container);
		fireEvent.click(container.querySelector("[data-reveal-secrets]")!);
		expect({masked, revealed, again: revealState(container)}).toStrictEqual({
			masked: {
				pre: `export GH=${MASKED_GH}\n`,
				pressed: "false",
				label: "Reveal 1 secret",
				tooltip: "Reveal 1 secret",
				iconPaths: 1,
			},
			revealed: {
				pre: `export GH=${FAKE_GH}\n`,
				pressed: "true",
				label: "Hide 1 secret",
				tooltip: "Hide 1 secret",
				iconPaths: 4,
			},
			again: masked,
		});
	});

	it("copies masked text while masked and raw text once revealed", () => {
		const {writeText, container} = renderWithClipboard(SECRET_FENCE);
		fireEvent.click(container.querySelector("[data-copy-code]")!);
		fireEvent.click(container.querySelector("[data-reveal-secrets]")!);
		fireEvent.click(container.querySelector("[data-copy-code]")!);
		expect(writeText.mock.calls).toStrictEqual([[`export GH=${MASKED_GH}\n`], [`export GH=${FAKE_GH}\n`]]);
	});

	it("gives the revealed toggle the pressed fill", () => {
		expect(
			ruleDeclarations(markdownCss, '.markdown :global(.markdown-code-copy) button[aria-pressed="true"]'),
		).toStrictEqual({background: "var(--color-fill-control)", color: "var(--color-primary)"});
	});
});

describe("inline code secret cloak behaviour", () => {
	afterEach(cleanup);

	it("reveals the raw value in place and hides it again", () => {
		const fake = "AKIAEXAMPLEFAKE12345";
		const {container} = render(<MarkdownArticle markdown={`\`${fake}\``} />);
		const state = () => {
			const button = container.querySelector("[data-redacted-secret] button")!;
			return {
				text: container.querySelector("[data-redacted-secret] .break-all")!.textContent,
				pressed: button.getAttribute("aria-pressed"),
				label: button.getAttribute("aria-label"),
				iconPaths: button.querySelectorAll("svg path").length,
			};
		};
		const masked = state();
		fireEvent.click(container.querySelector("[data-redacted-secret] button")!);
		const revealed = state();
		fireEvent.click(container.querySelector("[data-redacted-secret] button svg")!);
		expect({masked, revealed, again: state()}).toStrictEqual({
			masked: {
				text: `Redacted AWS access keyAKIAEXAM${"\u2022".repeat(12)}`,
				pressed: "false",
				label: "Reveal AWS access key",
				iconPaths: 1,
			},
			revealed: {text: fake, pressed: "true", label: "Hide AWS access key", iconPaths: 4},
			again: masked,
		});
	});
});
