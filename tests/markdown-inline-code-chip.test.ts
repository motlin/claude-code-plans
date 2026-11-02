import {describe, expect, it} from "vite-plus/test";
import {markdownCss, ruleDeclarations} from "./markdown-css";
import {renderMarkdownToHtml} from "../src/lib/client-markdown";
import {parseFileRefText} from "../src/lib/file-refs";
import {EYE_ICON_SVG} from "../src/lib/icon-paths";

describe("inline code chip", () =>
{
	it("inks a leading-none 0.9em/400 chip red on a 5% tint like the upstream prose chip", () =>
	{
		expect(ruleDeclarations(markdownCss, ".markdown code")).toStrictEqual(
			{
				"font-family": "var(--font-mono)",
				"font-size": "0.9em",
				"font-weight": "400",
				"line-height": "1",
				background: "var(--color-alpha-1)",
				border: "none",
				color: "var(--color-code-ink)",
				"border-radius": "0.4em",
				padding: "0.0625em 0.25em",
			},
		);
	});

	it("leaves dark mode to the themed tokens instead of a hard-coded override", () =>
	{
		expect(markdownCss.includes(":global(.dark) .markdown code")).toBe(false);
	});

	it("hairlines the transcript prose chip in both themes, 0.5px white/10% in dark like upstream", () =>
	{
		expect(
			{
				light: ruleDeclarations(
					markdownCss,
					":global(:root:not(.dark)) :global([data-transcript-prose]) .markdown code:not(pre code)",
				),
				dark: ruleDeclarations(
					markdownCss,
					":global(.dark) :global([data-transcript-prose]) .markdown code:not(pre code)",
				),
			},
		).toStrictEqual(
			{
				light:
				{
					border: "1px solid rgb(11 11 11 / 0.1)",
				},
				dark:
				{
					border: "0.5px solid rgb(255 255 255 / 0.1)",
				},
			},
		);
	});

	it("keeps fenced code at the 20px code line-height the tightened chip would otherwise steal", () =>
	{
		expect(ruleDeclarations(markdownCss, ".markdown pre code")).toStrictEqual(
			{
				background: "none",
				border: "none",
				color: "inherit",
				padding: "0",
				"font-weight": "400",
				"line-height": "20px",
				"border-radius": "0",
			},
		);
	});
});

describe("inline code secret cloak", () =>
{
	const FAKE_AWS = "AKIAEXAMPLEFAKE12345";
	const MASKED_AWS = `AKIAEXAM${"•".repeat(12)}`;
	const FAKE_GH = `ghp_${"A".repeat(36)}`;
	const MASKED_GH = `ghp_AAAA${"•".repeat(32)}`;
	const cloak = (label: string, masked: string, raw: string) =>
		`<span data-redacted-secret="" class="inline-flex max-w-full items-baseline gap-[2px] align-baseline"><span class="break-all"><span data-find-omitted="" class="sr-only select-none">Redacted ${label}</span><span aria-hidden="true">${masked}</span><template data-secret-raw>${raw}</template></span><button type="button" aria-pressed="false" aria-label="Reveal ${label}" class="inline-flex shrink-0 translate-y-[1px] items-center justify-center rounded-r2 text-secondary focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus hover:text-primary">${EYE_ICON_SVG}</button></span>`;

	it("wraps a secret in a cloak with a per-secret reveal button", () =>
	{
		expect(renderMarkdownToHtml(`key \`id=${FAKE_AWS}\``)).toBe(
			`<p>key <code data-code-text="id=${MASKED_AWS}">id=${cloak("AWS access key", MASKED_AWS, FAKE_AWS)}</code></p>\n`,
		);
	});

	it("does not render a path containing a secret as a file ref", () =>
	{
		const path = `src/${FAKE_GH}/a.ts`;
		const refs = new Map([
			[
				path,
				{
					path: `/repo/${path}`,
				},
			],
		]);
		expect(
			renderMarkdownToHtml(
				`\`${path}\``,
				{
					fileRefs: refs,
				},
			),
		).toBe(
			`<p><code data-code-text="src/${MASKED_GH}/a.ts">src/${cloak("GitHub token", MASKED_GH, FAKE_GH)}/a.ts</code></p>\n`,
		);
	});

	it("does not propose a path containing a secret as a file ref", () =>
	{
		expect(parseFileRefText(`src/${FAKE_GH}/a.ts`)).toBe(null);
	});

	it("masks link labels and drops a link whose href holds a secret", () =>
	{
		expect(renderMarkdownToHtml(`[${FAKE_GH}](https://x.test/) and https://x.test/${FAKE_GH}`)).toBe(
			`<p><a href="https://x.test/" target="_blank" rel="noreferrer">${MASKED_GH}</a> and https://x.test/${MASKED_GH}</p>\n`,
		);
	});

	it("masks image alt text", () =>
	{
		expect(renderMarkdownToHtml(`![${FAKE_GH}](https://x.test/a.png)`)).toBe(
			`<p><img src="https://x.test/a.png" alt="${MASKED_GH}"></p>\n`,
		);
	});
});
