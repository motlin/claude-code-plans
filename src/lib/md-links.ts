import { toMdSlug } from "./md-slug";

/**
 * Build the in-app URL for a `.md` file that lives alongside the one currently
 * being rendered. `basePath` is the route prefix the sibling is addressed under
 * (`/memory/<project>`, for instance), and the filename loses its extension
 * because those routes are keyed by slug, not by the on-disk name.
 */
export function mdFileHref(basePath: string, filename: string): string {
  return `${basePath}/${encodeURIComponent(toMdSlug(filename))}`;
}

/** Anything with a scheme (`https:`, `mailto:`) or a protocol-relative prefix. */
const ABSOLUTE_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Rewrite a relative `.md` link found inside a markdown body so it points at
 * the in-app route that serves the file. Links written in a memory file keep
 * their `.md` extension, but the route param drops it, and a path segment with
 * a dot in it 404s outright — so an unrewritten link is a dead link.
 *
 * Returns null for anything that is not a same-directory `.md` reference, which
 * leaves external links, absolute paths, and bare fragments untouched.
 */
export function resolveRelativeMdHref(href: string, basePath: string): string | null {
  if (!href || href.startsWith("#") || href.startsWith("/") || ABSOLUTE_RE.test(href)) return null;

  const hashIndex = href.indexOf("#");
  const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);

  const relative = path.startsWith("./") ? path.slice(2) : path;
  // Memory directories are flat, so a link that traverses into another
  // directory has no in-app route to point at.
  if (!relative.endsWith(".md") || relative.includes("/") || relative.includes("?")) return null;

  return `${mdFileHref(basePath, relative)}${hash}`;
}
