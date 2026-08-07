/**
 * Single source of truth for client-side markdown rendering.
 *
 * Shiki, MarkdownIt, and the markdown-it plugins are all dynamic-imported so
 * Vite emits them as a lazy chunk. The chunk is fetched only when a markdown
 * render is first requested, then cached for subsequent renders.
 *
 * Use `renderMarkdown(markdown)` from any client code, or render through the
 * `<MarkdownView markdown={...} />` component which wraps it with a raw-`<pre>`
 * fallback for the time before the chunk arrives.
 */
import type { HighlighterCore } from "@shikijs/core";

let highlighterPromise: Promise<HighlighterCore> | null = null;

async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise) return highlighterPromise;
  highlighterPromise = (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, { claudeLight }] =
      await Promise.all([
        import("@shikijs/core"),
        import("@shikijs/engine-javascript"),
        import("./claude-light-theme"),
      ]);
    return createHighlighterCore({
      themes: [claudeLight, import("shiki/themes/github-dark.mjs")],
      langs: [
        import("shiki/langs/typescript.mjs"),
        import("shiki/langs/tsx.mjs"),
        import("shiki/langs/javascript.mjs"),
        import("shiki/langs/jsx.mjs"),
        import("shiki/langs/json.mjs"),
        import("shiki/langs/python.mjs"),
        import("shiki/langs/css.mjs"),
        import("shiki/langs/html.mjs"),
        import("shiki/langs/markdown.mjs"),
        import("shiki/langs/yaml.mjs"),
        import("shiki/langs/shellscript.mjs"),
        import("shiki/langs/rust.mjs"),
        import("shiki/langs/go.mjs"),
        import("shiki/langs/ruby.mjs"),
        import("shiki/langs/java.mjs"),
        import("shiki/langs/sql.mjs"),
        import("shiki/langs/toml.mjs"),
        import("shiki/langs/xml.mjs"),
        import("shiki/langs/c.mjs"),
        import("shiki/langs/cpp.mjs"),
      ],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighterPromise;
}

interface MarkdownItLike {
  render(src: string): string;
  renderInline(src: string): string;
}

let mdPromise: Promise<MarkdownItLike> | null = null;

async function getMd(): Promise<MarkdownItLike> {
  if (mdPromise) return mdPromise;
  mdPromise = (async () => {
    const highlighter = await getHighlighter();
    const [{ default: MarkdownIt }, { default: taskLists }, { default: footnote }] =
      await Promise.all([
        import("markdown-it"),
        import("markdown-it-task-lists"),
        import("markdown-it-footnote"),
      ]);

    const loadedLanguages = highlighter.getLoadedLanguages();
    const md = MarkdownIt({
      html: false,
      linkify: true,
      typographer: true,
      highlight(code: string, lang: string): string {
        const language = lang || "text";
        if (language === "text" || !loadedLanguages.includes(language)) return "";
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
    md.use(taskLists);
    md.use(footnote);
    return md;
  })();
  return mdPromise;
}

/**
 * Render markdown to HTML on the client. Lazy-loads Shiki + MarkdownIt on
 * first call; subsequent calls reuse the cached instances.
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  if (!markdown.trim()) return "";
  const md = await getMd();
  return md.render(markdown);
}

/**
 * Render markdown as inline HTML on the client (no `<p>` wrap, no block
 * elements). Suitable for short single-line snippets like task subjects.
 */
async function renderInlineMarkdown(markdown: string): Promise<string> {
  if (!markdown.trim()) return "";
  const md = await getMd();
  return md.renderInline(markdown);
}

/**
 * Fire-and-forget preload of the markdown rendering chunk. Safe to call
 * multiple times — the underlying `mdPromise` cache makes it idempotent.
 * Use at app startup so the chunk is ready before any `MarkdownView` mounts.
 */
export function preloadMarkdown(): void {
  void getMd();
}

const MARKDOWN_PROMISE_CACHE_MAX = 64;
const markdownPromiseCache = new Map<string, Promise<string>>();
const inlineMarkdownPromiseCache = new Map<string, Promise<string>>();

function getOrSetCached(
  cache: Map<string, Promise<string>>,
  key: string,
  factory: () => Promise<string>,
): Promise<string> {
  const existing = cache.get(key);
  if (existing) return existing;
  const promise = factory();
  cache.set(key, promise);
  while (cache.size > MARKDOWN_PROMISE_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return promise;
}

/**
 * Memoized promise variant of `renderMarkdown` suitable for React 19's `use()`.
 * Returns a stable promise reference per `markdown` input so suspense doesn't
 * re-trigger on every render. Bounded to the last 64 inputs via FIFO eviction.
 */
export function renderMarkdownPromise(markdown: string): Promise<string> {
  return getOrSetCached(markdownPromiseCache, markdown, () => renderMarkdown(markdown));
}

/**
 * Memoized promise variant of `renderInlineMarkdown` suitable for React 19's
 * `use()`. Returns a stable promise reference per `markdown` input. Bounded to
 * the last 64 inputs via FIFO eviction.
 */
export function renderInlineMarkdownPromise(markdown: string): Promise<string> {
  return getOrSetCached(inlineMarkdownPromiseCache, markdown, () => renderInlineMarkdown(markdown));
}
