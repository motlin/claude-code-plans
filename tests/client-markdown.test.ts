// @vitest-environment jsdom

import type {HighlighterCore} from "@shikijs/core";
import {beforeEach, vi} from "vite-plus/test";
import {
	renderInlineMarkdownToHtml,
	renderMarkdownToHtml,
	renderMarkdownWithHighlighting,
	looksLikeMarkdown,
	renderArtifactLinkCard,
} from "../src/lib/client-markdown";

const {requestLanguageMock, requestThemeMock} = vi.hoisted(() => ({
	requestLanguageMock: vi.fn(() => Promise.resolve()),
	requestThemeMock: vi.fn((_theme: string) => Promise.resolve()),
}));

vi.mock("../src/hooks/use-shiki", async () => {
	const {loadedThemeOr} = await import("../src/lib/code-themes");
	return {
		requestLanguage: requestLanguageMock,
		themeOrRequest: (...args: Parameters<typeof loadedThemeOr>) => {
			const usable = loadedThemeOr(...args);
			if (usable !== args[1]) void requestThemeMock(args[1]);
			return usable;
		},
	};
});

beforeEach(() => {
	requestLanguageMock.mockClear();
	requestThemeMock.mockClear();
});

/** Drops the copy-button chrome the fence renderer wraps every code block in. */
function withoutCopyChrome(html: string): string {
	return html
		.replaceAll('<div class="markdown-codeblock">', "")
		.replaceAll(/<div class="markdown-code-copy-rail">[\s\S]*?<\/div><\/div><\/div>/g, "");
}

describe("renderInlineMarkdownToHtml", () => {
	it("renders inline markdown without a paragraph wrapper", () => {
		expect(renderInlineMarkdownToHtml("**bold** text")).toBe("<strong>bold</strong> text");
	});

	it("renders blank input as an empty string", () => {
		expect([renderInlineMarkdownToHtml(""), renderInlineMarkdownToHtml("   \n")]).toStrictEqual(["", ""]);
	});

	it("linkifies URLs", () => {
		expect(renderInlineMarkdownToHtml("see https://example.com")).toBe(
			'see <a href="https://example.com" target="_blank" rel="noreferrer">https://example.com</a>',
		);
	});
});

describe("looksLikeMarkdown", () => {
	it("returns true for text with 2+ markdown indicators", () => {
		// heading + bullet list
		expect(looksLikeMarkdown("# Title\n- item 1\n- item 2")).toBe(true);
		// bold + link
		expect(looksLikeMarkdown("**bold text** and [a link](http://example.com)")).toBe(true);
		// code fence + heading
		expect(looksLikeMarkdown("# Code\n```\nconst x = 1;\n```")).toBe(true);
		// bullet list + bold
		expect(looksLikeMarkdown("- **bold item**\n- another item")).toBe(true);
	});

	it("returns false for text with fewer than 2 indicators", () => {
		// just a bullet list (1 indicator)
		expect(looksLikeMarkdown("- item 1\n- item 2\n- item 3")).toBe(false);
		// just a heading (1 indicator)
		expect(looksLikeMarkdown("# Title\nSome plain text here")).toBe(false);
		// plain text (0 indicators)
		expect(looksLikeMarkdown("Just some regular text on multiple lines\nMore text here")).toBe(false);
	});

	it("returns false for empty or whitespace text", () => {
		expect(looksLikeMarkdown("")).toBe(false);
		expect(looksLikeMarkdown("   ")).toBe(false);
	});

	it("detects computer tool results with markdown formatting", () => {
		// Typical claude-in-chrome computer tool result with markdown
		const computerResult = `## Page Content

The page shows:
- **Navigation bar** at the top
- A search input field
- [Documentation link](https://docs.example.com)`;
		expect(looksLikeMarkdown(computerResult)).toBe(true);
	});
});

describe("renderMarkdownToHtml", () => {
	it("renders markdown headings to HTML", () => {
		const result = renderMarkdownToHtml("# Hello");
		expect(result).toContain("<h1>Hello</h1>");
	});

	it("renders empty/whitespace-only input as empty string", () => {
		expect(renderMarkdownToHtml("")).toBe("");
		expect(renderMarkdownToHtml("   ")).toBe("");
		expect(renderMarkdownToHtml("\n")).toBe("");
	});

	it("renders inline formatting", () => {
		const result = renderMarkdownToHtml("**bold** and *italic*");
		expect(result).toContain("<strong>bold</strong>");
		expect(result).toContain("<em>italic</em>");
	});

	it("renders code blocks with pre/code tags", () => {
		const result = renderMarkdownToHtml("```js\nconst x = 1;\n```");
		expect(result).toContain("<pre>");
		expect(result).toContain("<code");
		expect(result).toContain("const x = 1;");
	});

	it("renders code blocks when the language is unspecified", () => {
		expect(withoutCopyChrome(renderMarkdownToHtml("```\nplain code\n```"))).toBe(
			"<pre><code>plain code\n</code></pre>\n",
		);
	});

	it("renders task lists via markdown-it-task-lists plugin", () => {
		const result = renderMarkdownToHtml("- [ ] unchecked\n- [x] checked");
		expect(result).toContain('type="checkbox"');
		expect(result).toContain("checked");
	});

	it("renders footnotes via markdown-it-footnote plugin", () => {
		const result = renderMarkdownToHtml("Text[^1]\n\n[^1]: Footnote content");
		expect(result).toContain("footnote");
	});

	it("linkifies URLs", () => {
		const result = renderMarkdownToHtml("Visit https://example.com today");
		expect(result).toContain('href="https://example.com"');
	});

	it("renders raw HTML as escaped text", () => {
		expect(renderMarkdownToHtml("<img src=x onerror=alert(1)>")).toBe(
			"<p>&lt;img src=x onerror=alert(1)&gt;</p>\n",
		);
	});

	it("returns the same instance on repeated calls (singleton)", () => {
		const result1 = renderMarkdownToHtml("# Test");
		const result2 = renderMarkdownToHtml("# Test");
		expect(result1).toBe(result2);
	});

	it("enables typographer without changing the default", () => {
		expect([
			renderMarkdownToHtml('He said "hi" -- ok', {typographer: true}),
			renderMarkdownToHtml('He said "hi" -- ok'),
		]).toStrictEqual(["<p>He said “hi” – ok</p>\n", "<p>He said &quot;hi&quot; -- ok</p>\n"]);
	});

	it("caches plain markdown instances by typographer setting", () => {
		expect([
			renderMarkdownToHtml('He said "hi" -- ok'),
			renderMarkdownToHtml('He said "hi" -- ok', {typographer: true}),
			renderMarkdownToHtml('He said "hi" -- ok'),
		]).toStrictEqual([
			"<p>He said &quot;hi&quot; -- ok</p>\n",
			"<p>He said “hi” – ok</p>\n",
			"<p>He said &quot;hi&quot; -- ok</p>\n",
		]);
	});
});

describe("mdLinkBase rewriting", () => {
	it("rewrites a relative .md link to the slug-based in-app route", () => {
		expect(
			renderMarkdownToHtml("[worktrees](always-work-in-worktree.md)", {
				mdLinkBase: "/memory/proj",
			}),
		).toBe('<p><a href="/memory/proj/always-work-in-worktree">worktrees</a></p>\n');
	});

	it("leaves an external https link untouched", () => {
		expect(
			renderMarkdownToHtml("[spec](https://example.com/notes.md)", {
				mdLinkBase: "/memory/proj",
			}),
		).toBe('<p><a href="https://example.com/notes.md" target="_blank" rel="noreferrer">spec</a></p>\n');
	});

	it("leaves relative .md links alone when no base is supplied", () => {
		expect(renderMarkdownToHtml("[worktrees](always-work-in-worktree.md)")).toBe(
			'<p><a href="always-work-in-worktree.md">worktrees</a></p>\n',
		);
	});

	it("re-reads the base on every render instead of caching the first one", () => {
		expect([
			renderMarkdownToHtml("[n](notes.md)", {mdLinkBase: "/memory/a"}),
			renderMarkdownToHtml("[n](notes.md)", {mdLinkBase: "/memory/b"}),
			renderMarkdownToHtml("[n](notes.md)"),
		]).toStrictEqual([
			'<p><a href="/memory/a/notes">n</a></p>\n',
			'<p><a href="/memory/b/notes">n</a></p>\n',
			'<p><a href="notes.md">n</a></p>\n',
		]);
	});

	it("rewrites relative .md links when a highlighter is bound", () => {
		const highlighter = {
			getLoadedLanguages: () => [],
			codeToHtml: () => "",
		} as unknown as HighlighterCore;

		expect(
			renderMarkdownWithHighlighting("[n](notes.md)", highlighter, {
				mdLinkBase: "/memory/proj",
			}),
		).toBe('<p><a href="/memory/proj/notes">n</a></p>\n');
	});

	it("links wiki-style cross references to sibling memories", () => {
		expect(
			renderMarkdownToHtml("See [[dotfiles-branch-topology]] and [[zsh-startup.md]].", {
				mdLinkBase: "/memory/proj",
			}),
		).toBe(
			'<p>See <a href="/memory/proj/dotfiles-branch-topology">dotfiles-branch-topology</a>' +
				' and <a href="/memory/proj/zsh-startup">zsh-startup.md</a>.</p>\n',
		);
	});

	it("leaves wiki-style references as literal text when no base is supplied", () => {
		expect(renderMarkdownToHtml("See [[dotfiles-branch-topology]].")).toBe(
			"<p>See [[dotfiles-branch-topology]].</p>\n",
		);
	});

	it("leaves bracket syntax inside code spans and fences alone", () => {
		expect(
			withoutCopyChrome(renderMarkdownToHtml("`[[raw]]`\n\n```\n[[fenced]]\n```", {mdLinkBase: "/memory/proj"})),
		).toBe("<p><code>[[raw]]</code></p>\n<pre><code>[[fenced]]\n</code></pre>\n");
	});

	it("ignores unterminated and empty wiki-style brackets", () => {
		expect([
			renderMarkdownToHtml("[[unterminated", {mdLinkBase: "/memory/proj"}),
			renderMarkdownToHtml("[[]]", {mdLinkBase: "/memory/proj"}),
		]).toStrictEqual(["<p>[[unterminated</p>\n", "<p>[[]]</p>\n"]);
	});
});

describe("renderMarkdownWithHighlighting", () => {
	it("falls back to plain rendering when highlighter is null", () => {
		const markdown = "# Hello\n\n```js\nconst x = 1;\n```";
		const result = renderMarkdownWithHighlighting(markdown, null);
		const plainResult = renderMarkdownToHtml(markdown);
		expect(result).toBe(plainResult);
	});

	it("returns empty string for empty input even with null highlighter", () => {
		expect(renderMarkdownWithHighlighting("", null)).toBe("");
		expect(renderMarkdownWithHighlighting("   ", null)).toBe("");
	});

	it("forwards typographer options when the highlighter is null", () => {
		expect(renderMarkdownWithHighlighting('a "b" -- c', null, {typographer: true})).toBe("<p>a “b” – c</p>\n");
	});

	it("renders non-code markdown the same with or without highlighter", () => {
		const markdown = "**bold** and *italic*";
		const result = renderMarkdownWithHighlighting(markdown, null);
		expect(result).toContain("<strong>bold</strong>");
		expect(result).toContain("<em>italic</em>");
	});

	it("renders raw HTML as escaped text with a highlighter", () => {
		const highlighter = {
			getLoadedLanguages: () => [],
			codeToHtml: () => "",
		} as unknown as HighlighterCore;

		expect(renderMarkdownWithHighlighting("<img src=x onerror=alert(1)>", highlighter)).toBe(
			"<p>&lt;img src=x onerror=alert(1)&gt;</p>\n",
		);
	});

	it("uses a grammar loaded after the cached markdown instance was created", () => {
		const loadedLanguages: string[] = [];
		const codeToHtml = vi.fn(() => '<pre class="shiki"><code>highlighted</code></pre>');
		const highlighter = {
			getLoadedLanguages: () => loadedLanguages,
			codeToHtml,
		} as unknown as HighlighterCore;
		const markdown = "```typescript\nconst answer = 0;\n```";

		const beforeLoad = renderMarkdownWithHighlighting(markdown, highlighter);
		loadedLanguages.push("typescript");
		const afterLoad = renderMarkdownWithHighlighting(markdown, highlighter);

		expect({
			beforeLoad: withoutCopyChrome(beforeLoad),
			afterLoad: withoutCopyChrome(afterLoad),
			languageRequests: requestLanguageMock.mock.calls,
			highlightingCalls: codeToHtml.mock.calls,
		}).toStrictEqual({
			beforeLoad: '<pre><code class="language-typescript">const answer = 0;\n</code></pre>\n',
			afterLoad: '<pre class="shiki"><code>highlighted</code></pre>\n',
			languageRequests: [["typescript"]],
			highlightingCalls: [
				[
					"const answer = 0;",
					{
						tokenizeTimeLimit: 0,
						tokenizeMaxLineLength: 20_000,
						lang: "typescript",
						themes: {
							light: "claude-light",
							dark: "github-dark",
						},
						defaultColor: "light",
						cssVariablePrefix: "--shiki-",
					},
				],
			],
		});
	});

	it("highlights with the chosen code themes once they are loaded, else the defaults", () => {
		const loadedThemes = ["claude-light", "github-dark"];
		const codeToHtml = vi.fn(() => '<pre class="shiki"><code>highlighted</code></pre>');
		const highlighter = {
			getLoadedLanguages: () => ["typescript"],
			getLoadedThemes: () => loadedThemes,
			codeToHtml,
		} as unknown as HighlighterCore;
		const markdown = "```typescript\nconst answer = 0;\n```";
		const codeThemes = {light: "min-light", dark: "nord"} as const;

		renderMarkdownWithHighlighting(markdown, highlighter, {codeThemes});
		loadedThemes.push("min-light", "nord");
		renderMarkdownWithHighlighting(markdown, highlighter, {codeThemes});

		expect({
			themes: codeToHtml.mock.calls.map((call) => (call as unknown as [string, {themes: unknown}])[1].themes),
			themeRequests: requestThemeMock.mock.calls,
		}).toStrictEqual({
			themes: [
				{light: "claude-light", dark: "github-dark"},
				{light: "min-light", dark: "nord"},
			],
			themeRequests: [["min-light"], ["nord"]],
		});
	});

	it("caches highlighted markdown instances by typographer setting", () => {
		const highlighter = {
			getLoadedLanguages: () => [],
			codeToHtml: () => "",
		} as unknown as HighlighterCore;

		expect([
			renderMarkdownWithHighlighting('He said "hi" -- ok', highlighter),
			renderMarkdownWithHighlighting('He said "hi" -- ok', highlighter, {
				typographer: true,
			}),
			renderMarkdownWithHighlighting('He said "hi" -- ok', highlighter),
		]).toStrictEqual([
			"<p>He said &quot;hi&quot; -- ok</p>\n",
			"<p>He said “hi” – ok</p>\n",
			"<p>He said &quot;hi&quot; -- ok</p>\n",
		]);
	});
});

describe("artifact link cards", () => {
	const knownId = "0f8fad5b-d9cb-469f-a165-70867728950e";
	const titles = new Map([[knownId, "Release Dashboard"]]);

	it("renders a known artifact link as a card titled from the artifacts index", () => {
		expect(
			renderMarkdownToHtml(`See [the dashboard](https://claude.ai/code/artifact/${knownId}).`, {
				artifactTitles: titles,
			}),
		).toBe(
			`<p>See <a href="https://claude.ai/code/artifact/${knownId}" target="_blank" rel="noopener noreferrer" class="artifact-link-card" data-artifact-link="" aria-label="Artifact: Release Dashboard" title="Artifact: Release Dashboard"><span class="artifact-link-card-title">Release Dashboard</span><span class="artifact-link-card-meta">Artifact · claude.ai</span></a>.</p>\n`,
		);
	});

	it("renders an unknown artifact link as a card titled with its link text", () => {
		expect(
			renderMarkdownToHtml("[My **page**](https://claude.ai/artifact/some-slug)", {
				artifactTitles: titles,
			}),
		).toBe(
			`<p><a href="https://claude.ai/artifact/some-slug" target="_blank" rel="noopener noreferrer" class="artifact-link-card" data-artifact-link="" aria-label="Artifact: My page" title="Artifact: My page"><span class="artifact-link-card-title">My page</span><span class="artifact-link-card-meta">Artifact · claude.ai</span></a></p>\n`,
		);
	});

	it("labels a bare linkified artifact URL with the URL when there is no index", () => {
		expect(renderMarkdownToHtml(`https://claude.ai/code/artifact/${knownId}`)).toBe(
			`<p><a href="https://claude.ai/code/artifact/${knownId}" target="_blank" rel="noopener noreferrer" class="artifact-link-card" data-artifact-link="" aria-label="Artifact: https://claude.ai/code/artifact/${knownId}" title="Artifact: https://claude.ai/code/artifact/${knownId}"><span class="artifact-link-card-title">https://claude.ai/code/artifact/${knownId}</span><span class="artifact-link-card-meta">Artifact · claude.ai</span></a></p>\n`,
		);
	});

	it("leaves other claude.ai links as plain links", () => {
		expect(renderMarkdownToHtml("[chat](https://claude.ai/chat/abc)")).toBe(
			'<p><a href="https://claude.ai/chat/abc" target="_blank" rel="noreferrer">chat</a></p>\n',
		);
	});
});

describe("renderArtifactLinkCard", () => {
	it("renders the same link card markdown links to artifacts get", () => {
		const href = "https://claude.ai/code/artifact/29d89ae8-e33b-4f55-bbbd-874d5d316169";
		expect(renderArtifactLinkCard(href, "A <b> page")).toBe(
			`<a href="${href}" target="_blank" rel="noopener noreferrer" class="artifact-link-card" data-artifact-link="" aria-label="Artifact: A &lt;b&gt; page" title="Artifact: A &lt;b&gt; page"><span class="artifact-link-card-title">A &lt;b&gt; page</span><span class="artifact-link-card-meta">Artifact · claude.ai</span></a>`,
		);
	});
});

describe("external links", () => {
	it("open a plain external link in a new tab without a referrer", () => {
		expect(renderMarkdownToHtml("[docs](https://example.com/a)")).toBe(
			'<p><a href="https://example.com/a" target="_blank" rel="noreferrer">docs</a></p>\n',
		);
	});

	it("leave in-app links in the same tab", () => {
		expect(renderMarkdownToHtml("[home](/sessions) and [top](#top)")).toBe(
			'<p><a href="/sessions">home</a> and <a href="#top">top</a></p>\n',
		);
	});
});

describe("GitHub PR chips", () => {
	const href = "https://github.com/motlin/claude-code-plans/pull/1954";

	it("render a linkified PR URL as a pr-chip reading owner/repo#n", () => {
		const html = renderMarkdownToHtml(`See ${href} for details`);
		const container = document.createElement("div");
		container.innerHTML = html;
		const chips = [...container.querySelectorAll("a.pr-chip")];
		expect(
			chips.map((chip) => ({
				href: chip.getAttribute("href"),
				target: chip.getAttribute("target"),
				rel: chip.getAttribute("rel"),
				text: chip.textContent,
				icon: chip.querySelector("svg")?.getAttribute("width"),
			})),
		).toStrictEqual([
			{
				href,
				target: "_blank",
				rel: "noreferrer",
				text: "motlin/claude-code-plans#1954",
				icon: "12",
			},
		]);
	});

	it("preserve a written PR link's text", () => {
		const url = "https://github.com/example-owner/example-repo/pull/123";
		expect(renderMarkdownToHtml(`[PR #123: Example sync](${url})`)).toBe(
			`<p><a href="${url}" target="_blank" rel="noreferrer">PR #123: Example sync</a></p>\n`,
		);
	});

	it("preserve an explicitly authored URL label", () => {
		const url = "https://github.com/example-owner/example-repo/pull/123";
		expect(renderMarkdownToHtml(`[${url}](${url})`)).toBe(
			`<p><a href="${url}" target="_blank" rel="noreferrer">${url}</a></p>\n`,
		);
	});

	it("preserve formatting inside an authored PR label", () => {
		const url = "https://github.com/example-owner/example-repo/pull/123";
		expect(renderMarkdownToHtml(`[**PR #123**: \`sync\`](${url})`)).toBe(
			`<p><a href="${url}" target="_blank" rel="noreferrer"><strong>PR #123</strong>: <code>sync</code></a></p>\n`,
		);
	});

	it("keep angle-bracket PR URLs as automatic chips", () => {
		const url = "https://github.com/example-owner/example-repo/pull/123";
		const container = document.createElement("div");
		container.innerHTML = renderMarkdownToHtml(`<${url}>`);
		expect(
			[...container.querySelectorAll("a")].map((a) => ({
				href: a.getAttribute("href"),
				target: a.getAttribute("target"),
				rel: a.getAttribute("rel"),
				className: a.className,
				text: a.textContent,
			})),
		).toStrictEqual([
			{
				href: url,
				target: "_blank",
				rel: "noreferrer",
				className: "pr-chip",
				text: "example-owner/example-repo#123",
			},
		]);
	});

	it("leave other GitHub links as plain links", () => {
		expect(renderMarkdownToHtml("[repo](https://github.com/motlin/claude-code-plans)")).toBe(
			'<p><a href="https://github.com/motlin/claude-code-plans" target="_blank" rel="noreferrer">repo</a></p>\n',
		);
	});
});
