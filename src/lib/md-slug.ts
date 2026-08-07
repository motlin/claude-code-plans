/**
 * Plan, memory, and command files live on disk as `<basename>.md`, but they are
 * addressed in the browser by `<basename>` alone. Vite's dev server treats any
 * URL path segment containing a dot as a static-asset request and refuses the
 * SPA fallback for it, so a hard refresh on `/plan/foo.md` 404s with
 * "Cannot GET" (production SSR handles it, dev does not). Dropping the `.md`
 * from the route param sidesteps that. The on-disk filename and every API/DB
 * key keep the extension — only the URL drops it.
 */
export const toMdSlug = (filename: string): string => filename.replace(/\.md$/, "");

export const fromMdSlug = (slug: string): string => `${slug}.md`;

/**
 * Plugin paths may contain dots in directory names as well as filenames, so
 * dropping only a trailing `.md` is not enough. Escape every dot (and the
 * escape character itself) to keep each route segment compatible with Vite's
 * development server while preserving the exact on-disk path.
 */
export const toPluginFileSlug = (pathSegment: string): string =>
  pathSegment.replaceAll("~", "~0").replaceAll(".", "~1");

export const fromPluginFileSlug = (slug: string): string =>
  slug.replaceAll("~1", ".").replaceAll("~0", "~");
