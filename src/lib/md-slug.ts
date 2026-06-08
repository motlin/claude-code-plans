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
