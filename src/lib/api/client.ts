import type { z } from "zod";

/**
 * Resolve a relative URL to an absolute one. In the browser, returns the URL
 * as-is. On the server (SSR loaders), `fetch` requires an absolute URL so we
 * prepend the local server origin. The port is read from the `PORT`
 * environment variable, falling back to 7526 (the project's default).
 */
function resolveUrl(url: string): string {
  if (typeof window !== "undefined") return url;
  if (/^https?:\/\//.test(url)) return url;
  const port = process.env["PORT"] ?? "7526";
  return `http://127.0.0.1:${port}${url}`;
}

async function parseOk<S extends z.ZodTypeAny>(
  url: string,
  schema: S,
  res: Response,
): Promise<z.infer<S>> {
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  }
  const json: unknown = await res.json();
  return schema.parse(json) as z.infer<S>;
}

/**
 * Typed fetch helper for REST endpoints. Validates the JSON response with the
 * given Zod schema and returns the inferred type. Use as the single
 * networking primitive for everything in `src/lib/api/<resource>.ts`.
 *
 * Throws on non-2xx HTTP responses or schema validation failures so
 * react-query treats them as query errors.
 */
export async function apiFetch<S extends z.ZodTypeAny>(
  url: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  const res = await fetch(resolveUrl(url), { credentials: "same-origin", ...init });
  return parseOk(url, schema, res);
}

/**
 * Like {@link apiFetch}, but resolves to `null` on a 404 instead of throwing.
 * Use for resources whose absence is an expected, renderable state — e.g. a
 * plan file deleted while a browser tab stayed parked on its URL, which would
 * otherwise crash the route's suspense boundary. All other non-2xx statuses
 * and schema-validation failures still throw.
 */
export async function apiFetchOptional<S extends z.ZodTypeAny>(
  url: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S> | null> {
  const res = await fetch(resolveUrl(url), { credentials: "same-origin", ...init });
  if (res.status === 404) {
    return null;
  }
  return parseOk(url, schema, res);
}
