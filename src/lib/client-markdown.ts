import type { HighlighterCore } from "@shikijs/core";
import MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import { requestLanguage } from "../hooks/use-shiki";
import { COPY_ICON_SVG } from "./icon-paths";
import { mdFileHref, resolveRelativeMdHref } from "./md-links";

interface MarkdownRenderOptions {
  typographer?: boolean;
  /**
   * Route prefix that sibling `.md` files are addressed under, e.g.
   * `/memory/<project>`. Supplying it turns relative `.md` links and
   * `[[wiki-style]]` cross references inside the body into in-app links.
   */
  mdLinkBase?: string;
}

/** Per-render state; the MarkdownIt instances themselves are cached and shared. */
interface MarkdownEnv {
  mdLinkBase?: string;
}

function toEnv(options?: MarkdownRenderOptions): MarkdownEnv {
  return options?.mdLinkBase === undefined ? {} : { mdLinkBase: options.mdLinkBase };
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

/** Marks the wrapper `<div>` a fenced code block and its copy button share. */
export const CODEBLOCK_CLASS = "markdown-codeblock";
/** Marks the absolutely positioned control strip holding the copy button. */
const CODEBLOCK_COPY_CLASS = "markdown-code-copy";
/** Marks the copy button itself, so one delegated listener can find it. */
export const CODEBLOCK_COPY_ATTR = "data-copy-code";

const COPY_STRIP = `<div class="${CODEBLOCK_COPY_CLASS}"><button type="button" ${CODEBLOCK_COPY_ATTR} aria-label="Copy">${COPY_ICON_SVG}</button></div>`;

/**
 * Memory files cross-reference each other with `[[name]]`, which plain markdown
 * leaves as literal text. Resolve it to the sibling memory when the caller told
 * us where siblings live; otherwise decline so the text renders unchanged.
 */
function wikiLink(state: StateInline, silent: boolean): boolean {
  const base = (state.env as MarkdownEnv | undefined)?.mdLinkBase;
  if (base === undefined) return false;

  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x5b /* [ */) return false;
  if (state.src.charCodeAt(start + 1) !== 0x5b) return false;

  const end = state.src.indexOf("]]", start + 2);
  if (end === -1 || end > state.posMax) return false;

  const label = state.src.slice(start + 2, end);
  if (!label || /[[\]\n]/.test(label)) return false;

  if (!silent) {
    state.push("link_open", "a", 1).attrs = [["href", mdFileHref(base, label)]];
    state.push("text", "", 0).content = label;
    state.push("link_close", "a", -1);
  }
  state.pos = end + 2;
  return true;
}

/** The plugins and renderer overrides every cached instance shares. */
function applyPlugins(instance: MarkdownIt): void {
  instance.use(taskLists);
  instance.use(footnote);
  instance.inline.ruler.before("link", "wikilink", wikiLink);

  // Links written inside a memory file keep their `.md` extension, but the
  // route that serves them is keyed by the extension-less slug, so an
  // unrewritten link is a hard 404 rather than a redirect.
  instance.renderer.rules["link_open"] = (tokens, idx, options, env, self) => {
    const base = (env as MarkdownEnv | undefined)?.mdLinkBase;
    if (base !== undefined) {
      const token = tokens[idx]!;
      const href = token.attrGet("href");
      const resolved = href === null ? null : resolveRelativeMdHref(href, base);
      if (resolved !== null) token.attrSet("href", resolved);
    }
    return self.renderToken(tokens, idx, options);
  };

  // Upstream wraps every fence in a relative box carrying an absolutely
  // positioned top-right control strip with an icon-only copy button; a bare
  // markdown-it `<pre>` has nowhere to anchor one.
  const renderFence = instance.renderer.rules["fence"]!;
  instance.renderer.rules["fence"] = (tokens, idx, options, env, self) =>
    `<div class="${CODEBLOCK_CLASS}">${renderFence(tokens, idx, options, env, self).trimEnd()}${COPY_STRIP}</div>\n`;

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
  return getPlainMarkdownIt(options).render(markdown, toEnv(options));
}

/** Render markdown to inline HTML without a paragraph wrapper. */
export function renderInlineMarkdownToHtml(
  markdown: string,
  options?: MarkdownRenderOptions,
): string {
  if (!markdown.trim()) return "";
  return getPlainMarkdownIt(options).renderInline(markdown, toEnv(options));
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
  return getHighlightedMarkdownIt(highlighter, options).render(markdown, toEnv(options));
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
