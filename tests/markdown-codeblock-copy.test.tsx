// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MarkdownArticle } from "../src/components/markdown-article";
import { renderMarkdownToHtml } from "../src/lib/client-markdown";
import { markdownCss, ruleDeclarations } from "./markdown-css";

const FENCE = "```js\nconst x = 1;\n```";

describe("fenced code block copy button markup", () => {
  it("wraps every fence in a codeblock wrapper carrying one copy button", () => {
    const html = renderMarkdownToHtml(`${FENCE}\n\n\`\`\`\nplain\n\`\`\``);

    expect({
      wrappers: html.match(/class="markdown-codeblock"/g)?.length ?? 0,
      strips: html.match(/class="markdown-code-copy"/g)?.length ?? 0,
      buttons: html.match(/<button type="button" data-copy-code aria-label="Copy">/g)?.length ?? 0,
      stripFollowsPre: html.includes('</code></pre><div class="markdown-code-copy">'),
    }).toStrictEqual({ wrappers: 2, strips: 2, buttons: 2, stripFollowsPre: true });
  });

  it("leaves inline code and prose unwrapped", () => {
    expect(renderMarkdownToHtml("a `snippet` in prose")).toBe(
      "<p>a <code>snippet</code> in prose</p>\n",
    );
  });

  it("anchors the control strip over the card's top-right corner like upstream", () => {
    expect({
      wrapper: ruleDeclarations(markdownCss, ".markdown :global(.markdown-codeblock)"),
      strip: ruleDeclarations(markdownCss, ".markdown :global(.markdown-code-copy)"),
    }).toStrictEqual({
      wrapper: {
        position: "relative",
        width: "fit-content",
        "max-width": "100%",
      },
      strip: {
        position: "absolute",
        top: "5px",
        right: "7px",
        display: "flex",
        gap: "3px",
        opacity: "0",
        transition: "opacity 150ms cubic-bezier(0.215, 0.61, 0.355, 1)",
      },
    });
  });

  it("reserves upstream's extra 24px of right padding on the wrapped pre", () => {
    expect(
      ruleDeclarations(markdownCss, ".markdown :global(.markdown-codeblock) > pre"),
    ).toStrictEqual({ margin: "0", "padding-right": "32px" });
  });

  it("reveals the strip on hover and while it holds focus", () => {
    const selector =
      ".markdown :global(.markdown-codeblock):hover :global(.markdown-code-copy),\n.markdown :global(.markdown-code-copy):focus-within";

    expect(ruleDeclarations(markdownCss, selector)).toStrictEqual({ opacity: "1" });
  });
});

describe("fenced code block copy button behaviour", () => {
  afterEach(cleanup);

  function renderWithClipboard(markdown: string) {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    return { writeText, container: render(<MarkdownArticle markdown={markdown} />).container };
  }

  it("copies the code block's text when its button is clicked", () => {
    const { writeText, container } = renderWithClipboard(FENCE);

    fireEvent.click(container.querySelector("[data-copy-code]")!);

    expect(writeText.mock.calls).toStrictEqual([["const x = 1;\n"]]);
  });

  it("copies the code of the block whose button was clicked", () => {
    const { writeText, container } = renderWithClipboard("```\nfirst\n```\n\n```\nsecond\n```");

    fireEvent.click(container.querySelectorAll("[data-copy-code]")[1]!);

    expect(writeText.mock.calls).toStrictEqual([["second\n"]]);
  });

  it("ignores clicks on the code itself", () => {
    const { writeText, container } = renderWithClipboard(FENCE);

    fireEvent.click(container.querySelector("pre")!);

    expect(writeText.mock.calls).toStrictEqual([]);
  });
});
