import { use } from "react";
import { renderInlineMarkdownPromise, renderMarkdownPromise } from "../lib/markdown";
import styles from "./markdown-article.module.css";

/**
 * Drop-in markdown render component. Uses React 19's {@link use} hook to read
 * the memoized rendering promise from `renderMarkdownPromise`. On the warm
 * path (markdown chunk preloaded, promise resolved) `use()` returns
 * synchronously and the first paint is fully styled HTML — no plain-text
 * flash. On the cold path it suspends, letting the nearest `<Suspense>`
 * boundary show a quiet fallback (see {@link MarkdownSkeleton}).
 */
export function MarkdownView({ markdown }: { markdown: string }) {
  const html = use(renderMarkdownPromise(markdown));
  return <article className={styles["markdown"]} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Inline variant of {@link MarkdownView}. Renders short markdown snippets
 * (e.g. task subjects) without paragraph wrapping. Suspends on the cold path
 * just like the block variant; `fallback={null}` at the call site is
 * appropriate for these short snippets.
 */
export function MarkdownInline({ markdown }: { markdown: string }) {
  const html = use(renderInlineMarkdownPromise(markdown));
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Quiet placeholder for a `<Suspense>` fallback wrapping {@link MarkdownView}.
 * Matches the article container's font metrics and shows a couple of muted
 * placeholder lines so the layout doesn't reflow when the rendered HTML swaps
 * in on the cold path.
 */
export function MarkdownSkeleton() {
  return (
    <article className={styles["markdown"]} aria-hidden="true">
      <div className="flex flex-col gap-2 py-1">
        <div className="h-3 w-3/4 rounded bg-bg-200/50" />
        <div className="h-3 w-5/6 rounded bg-bg-200/50" />
        <div className="h-3 w-2/3 rounded bg-bg-200/50" />
      </div>
    </article>
  );
}
