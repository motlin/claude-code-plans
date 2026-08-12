import type { HighlighterCore } from "@shikijs/core";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import { requestLanguage } from "../hooks/use-shiki";

interface MarkdownRenderOptions {
  typographer?: boolean;
}

type MarkdownVariant = "default" | "typographer";

const plainInstances: Record<MarkdownVariant, MarkdownIt | null> = {
  default: null,
  typographer: null,
};
const highlightedInstances: Record<MarkdownVariant, MarkdownIt | null> = {
  default: null,
  typographer: null,
};
const boundHighlighters: Record<MarkdownVariant, HighlighterCore | null> = {
  default: null,
  typographer: null,
};

function getMarkdownVariant(options?: MarkdownRenderOptions): MarkdownVariant {
  return options?.typographer ? "typographer" : "default";
}

/** The plugins and renderer overrides every cached instance shares. */
function applyPlugins(instance: MarkdownIt): void {
  instance.use(taskLists);
  instance.use(footnote);

  // Upstream renders every table inside an `overflow-x-auto` div so a table wider
  // than the transcript column scrolls on its own instead of stretching the column.
  instance.renderer.rules["table_open"] = (tokens, idx, options, _env, self) =>
    `<div class="markdown-table-wrapper">${self.renderToken(tokens, idx, options)}`;
  instance.renderer.rules["table_close"] = (tokens, idx, options, _env, self) =>
    `${self.renderToken(tokens, idx, options)}</div>`;
}

function getPlainMarkdownIt(options?: MarkdownRenderOptions): MarkdownIt {
  const variant = getMarkdownVariant(options);
  const cachedInstance = plainInstances[variant];
  if (cachedInstance) return cachedInstance;

  const instance = MarkdownIt({
    html: false,
    linkify: true,
    typographer: options?.typographer ?? false,
  });
  applyPlugins(instance);
  plainInstances[variant] = instance;
  return instance;
}

function getHighlightedMarkdownIt(
  highlighter: HighlighterCore,
  options?: MarkdownRenderOptions,
): MarkdownIt {
  const variant = getMarkdownVariant(options);

  // Re-use the cached instance if the highlighter hasn't changed.
  const cachedInstance = highlightedInstances[variant];
  if (cachedInstance && boundHighlighters[variant] === highlighter) return cachedInstance;

  const instance = MarkdownIt({
    html: false,
    linkify: true,
    typographer: options?.typographer ?? false,
    highlight(code: string, lang: string): string {
      const language = lang || "text";
      if (language === "text") return "";
      if (!highlighter.getLoadedLanguages().includes(language)) {
        void requestLanguage(language);
        return "";
      }
      try {
        let trimmed = code;
        if (trimmed.endsWith("\n")) trimmed = trimmed.slice(0, -1);
        return highlighter.codeToHtml(trimmed, {
          lang: language,
          themes: {
            light: "claude-light",
            dark: "github-dark",
          },
          defaultColor: "light",
          cssVariablePrefix: "--shiki-",
        });
      } catch {
        return "";
      }
    },
  });
  applyPlugins(instance);
  highlightedInstances[variant] = instance;
  boundHighlighters[variant] = highlighter;
  return instance;
}

/** Render markdown to HTML without syntax highlighting. */
export function renderMarkdownToHtml(markdown: string, options?: MarkdownRenderOptions): string {
  if (!markdown.trim()) return "";
  return getPlainMarkdownIt(options).render(markdown);
}

/** Render markdown to inline HTML without a paragraph wrapper. */
export function renderInlineMarkdownToHtml(
  markdown: string,
  options?: MarkdownRenderOptions,
): string {
  if (!markdown.trim()) return "";
  return getPlainMarkdownIt(options).renderInline(markdown);
}

/**
 * Render markdown to HTML with Shiki syntax highlighting for code blocks.
 * When `highlighter` is null (not yet loaded), falls back to unstyled code.
 */
export function renderMarkdownWithHighlighting(
  markdown: string,
  highlighter: HighlighterCore | null,
  options?: MarkdownRenderOptions,
): string {
  if (!markdown.trim()) return "";
  if (!highlighter) return renderMarkdownToHtml(markdown, options);
  return getHighlightedMarkdownIt(highlighter, options).render(markdown);
}

export function looksLikeMarkdown(text: string): boolean {
  let indicators = 0;
  if (/^#{1,6}\s/m.test(text)) indicators++;
  if (/```/.test(text)) indicators++;
  if (/^\s*[-*]\s/m.test(text)) indicators++;
  if (/\*\*[^*]+\*\*/.test(text)) indicators++;
  if (/\[[^\]]+\]\([^)]+\)/.test(text)) indicators++;
  return indicators >= 2;
}
