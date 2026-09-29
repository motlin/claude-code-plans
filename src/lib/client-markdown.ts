import type { HighlighterCore } from "@shikijs/core";
import MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import { requestLanguage, themeOrRequest } from "../hooks/use-shiki";
import { type CodeThemePair, DEFAULT_CODE_THEMES } from "./code-themes";
import type { FileRef } from "./file-refs";
import { normalizeArtifactUrl } from "./artifact-output";
import { COPY_ICON_SVG } from "./icon-paths";
import { mdFileHref, resolveRelativeMdHref } from "./md-links";
import { SHIKI_TOKENIZE_OPTIONS } from "./shiki-tokenize-options";

interface MarkdownRenderOptions {
  typographer?: boolean;
  /**
   * Route prefix that sibling `.md` files are addressed under, e.g.
   * `/memory/<project>`. Supplying it turns relative `.md` links and
   * `[[wiki-style]]` cross references inside the body into in-app links.
   */
  mdLinkBase?: string;
  /**
   * Inline code whose text is a key renders as a clickable file ref instead of
   * a code chip; see {@link FILE_REF_ATTR}.
   */
  fileRefs?: ReadonlyMap<string, FileRef>;
  /**
   * Titles from the artifacts index keyed by artifact id; a claude.ai artifact
   * link whose id is here is labelled with the indexed title.
   */
  artifactTitles?: ReadonlyMap<string, string>;
  /** Settings ▸ Code appearance themes for fenced code; defaults when omitted. */
  codeThemes?: CodeThemePair;
}

/** Per-render state; the MarkdownIt instances themselves are cached and shared. */
interface MarkdownEnv {
  mdLinkBase?: string;
  fileRefs?: ReadonlyMap<string, FileRef>;
  artifactTitles?: ReadonlyMap<string, string>;
}

function toEnv(options?: MarkdownRenderOptions): MarkdownEnv {
  const env: MarkdownEnv = {};
  if (options?.mdLinkBase !== undefined) env.mdLinkBase = options.mdLinkBase;
  if (options?.fileRefs !== undefined) env.fileRefs = options.fileRefs;
  if (options?.artifactTitles !== undefined) env.artifactTitles = options.artifactTitles;
  return env;
}

/** Marks a transcript file ref; its `data-file-*` attributes carry the target. */
export const FILE_REF_ATTR = "data-file-ref";

function fileRefHtml(text: string, ref: FileRef, escape: (value: string) => string): string {
  const attrs = [
    `role="button"`,
    `tabindex="0"`,
    `class="prose-link"`,
    `${FILE_REF_ATTR}=""`,
    `data-file-path="${escape(ref.path)}"`,
    ...(ref.line === undefined ? [] : [`data-file-line="${ref.line}"`]),
    ...(ref.endLine === undefined ? [] : [`data-file-end-line="${ref.endLine}"`]),
    `title="${escape(text)}"`,
  ];
  return `<span ${attrs.join(" ")}><span data-inline-code="">${escape(text)}</span></span>`;
}

/** Read the ref a {@link FILE_REF_ATTR} element carries. */
export function fileRefFromElement(element: Element): FileRef | null {
  const path = element.getAttribute("data-file-path");
  if (path === null) return null;
  const ref: FileRef = { path };
  const line = element.getAttribute("data-file-line");
  const endLine = element.getAttribute("data-file-end-line");
  if (line !== null) ref.line = Number(line);
  if (endLine !== null) ref.endLine = Number(endLine);
  return ref;
}

type MarkdownVariant = "default" | "typographer";

const plainInstances: Record<MarkdownVariant, MarkdownIt | null> = {
  default: null,
  typographer: null,
};
/** Highlighted instances keyed by variant and the code theme pair they render with. */
const highlightedInstances = new Map<string, MarkdownIt>();
const boundHighlighters = new Map<string, HighlighterCore>();

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

/** Marks a claude.ai artifact link rendered as upstream's link card. */
const ARTIFACT_LINK_ATTR = "data-artifact-link";

const ARTIFACT_LINK_TOKEN = "artifact_link";

/** The plain text of the inline tokens between a link's open and close. */
function linkText(tokens: readonly Token[]): string {
  return tokens
    .filter((token) => token.type === "text" || token.type === "code_inline")
    .map((token) => token.content)
    .join("");
}

/**
 * Upstream renders a markdown link to a claude.ai artifact as a link card
 * rather than inline text. Collapse each such link, whether written or
 * linkified, into one token the renderer turns into that card.
 */
function artifactLinks(state: StateCore): void {
  for (const block of state.tokens) {
    const children = block.children;
    if (block.type !== "inline" || children === null) continue;
    const rewritten: Token[] = [];
    for (let index = 0; index < children.length; index++) {
      const token = children[index]!;
      const href = token.type === "link_open" ? token.attrGet("href") : null;
      const artifact = href === null ? undefined : normalizeArtifactUrl(href);
      const close =
        artifact === undefined
          ? -1
          : children.findIndex((child, at) => at > index && child.type === "link_close");
      if (href === null || artifact === undefined || close === -1) {
        rewritten.push(token);
        continue;
      }
      const card = new state.Token(ARTIFACT_LINK_TOKEN, "a", 0);
      card.attrs = [["href", href]];
      card.meta = { id: artifact.id, host: new URL(href).host };
      card.content = linkText(children.slice(index + 1, close));
      rewritten.push(card);
      index = close;
    }
    block.children = rewritten;
  }
}

function artifactLinkHtml(token: Token, env: MarkdownEnv, escape: (value: string) => string) {
  const { id, host } = token.meta as { id: string; host: string };
  const href = token.attrGet("href") ?? "";
  const title = env.artifactTitles?.get(id) ?? token.content;
  const label = escape(`Artifact: ${title}`);
  const attrs = [
    `href="${escape(href)}"`,
    `target="_blank"`,
    `rel="noopener noreferrer"`,
    `class="artifact-link-card"`,
    `${ARTIFACT_LINK_ATTR}=""`,
    `aria-label="${label}"`,
    `title="${label}"`,
  ];
  return `<a ${attrs.join(" ")}><span class="artifact-link-card-title">${escape(title)}</span><span class="artifact-link-card-meta">Artifact · ${escape(host)}</span></a>`;
}

/** The plugins and renderer overrides every cached instance shares. */
function applyPlugins(instance: MarkdownIt): void {
  instance.use(taskLists);
  instance.use(footnote);
  instance.inline.ruler.before("link", "wikilink", wikiLink);
  instance.core.ruler.push(ARTIFACT_LINK_TOKEN, artifactLinks);
  instance.renderer.rules[ARTIFACT_LINK_TOKEN] = (tokens, idx, _options, env) =>
    artifactLinkHtml(tokens[idx]!, (env ?? {}) as MarkdownEnv, instance.utils.escapeHtml);

  // Links written inside a memory file keep their `.md` extension, but the
  // route that serves them is keyed by the extension-less slug, so an
  // unrewritten link is a hard 404 rather than a redirect.
  const renderCodeInline = instance.renderer.rules["code_inline"]!;
  instance.renderer.rules["code_inline"] = (tokens, idx, options, env, self) => {
    const text = tokens[idx]!.content;
    const ref = (env as MarkdownEnv | undefined)?.fileRefs?.get(text);
    return ref === undefined
      ? renderCodeInline(tokens, idx, options, env, self)
      : fileRefHtml(text, ref, instance.utils.escapeHtml);
  };

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
  const chosen = options?.codeThemes ?? DEFAULT_CODE_THEMES;
  const themes = {
    light:
      chosen.light === DEFAULT_CODE_THEMES.light
        ? chosen.light
        : themeOrRequest(highlighter, chosen.light, DEFAULT_CODE_THEMES.light),
    dark:
      chosen.dark === DEFAULT_CODE_THEMES.dark
        ? chosen.dark
        : themeOrRequest(highlighter, chosen.dark, DEFAULT_CODE_THEMES.dark),
  };
  const cacheKey = `${variant}:${themes.light}:${themes.dark}`;

  // Re-use the cached instance if the highlighter hasn't changed.
  const cachedInstance = highlightedInstances.get(cacheKey);
  if (cachedInstance && boundHighlighters.get(cacheKey) === highlighter) return cachedInstance;

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
          ...SHIKI_TOKENIZE_OPTIONS,
          lang: language,
          themes,
          defaultColor: "light",
          cssVariablePrefix: "--shiki-",
        });
      } catch {
        return "";
      }
    },
  });
  applyPlugins(instance);
  highlightedInstances.set(cacheKey, instance);
  boundHighlighters.set(cacheKey, highlighter);
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

const ARTIFACT_URL_HINT = /claude\.ai\/(?:code\/)?artifact\//;

/** Whether `markdown` may hold a claude.ai artifact link worth resolving titles for. */
export function mentionsArtifactUrl(markdown: string): boolean {
  return ARTIFACT_URL_HINT.test(markdown);
}

/** The text of every inline code span in `markdown`, in document order. */
export function inlineCodeTexts(markdown: string): string[] {
  const texts: string[] = [];
  for (const token of getPlainMarkdownIt().parse(markdown, {})) {
    for (const child of token.children ?? []) {
      if (child.type === "code_inline") texts.push(child.content);
    }
  }
  return texts;
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
