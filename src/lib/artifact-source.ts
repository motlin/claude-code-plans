import { realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import MarkdownIt from "markdown-it";
import { isPreviewableSourcePath } from "./artifact-source-paths";
import * as schema from "./db/schema";

export { isPreviewableSourcePath };

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * Served pages get an opaque origin even when opened directly, so a
 * previewed artifact can run its scripts but never call this app's APIs.
 */
export const ARTIFACT_SOURCE_CSP =
  "sandbox allow-scripts; default-src * data: blob: 'unsafe-inline'";

const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9-]+$/;

const SOURCE_HEADERS = {
  "Content-Security-Policy": ARTIFACT_SOURCE_CSP,
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
} as const;

function notFound(): Response {
  return new Response("Artifact source not found", {
    status: 404,
    headers: { ...SOURCE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Resolves the source file recorded for an artifact, or null. Only that
 * recorded path is ever considered, and only when both it and the file it
 * resolves to are previewable regular files.
 */
function resolveArtifactSource(db: IndexDb, id: string): string | null {
  if (!ARTIFACT_ID_PATTERN.test(id)) return null;
  const row = db
    .select({ sourcePath: schema.artifacts.sourcePath })
    .from(schema.artifacts)
    .where(eq(schema.artifacts.id, id))
    .get();
  const sourcePath = row?.sourcePath;
  if (sourcePath === null || sourcePath === undefined) return null;
  if (!isPreviewableSourcePath(sourcePath) || sourcePath.split("/").includes("..")) return null;
  try {
    const realPath = realpathSync(sourcePath);
    if (!isPreviewableSourcePath(realPath) || !statSync(realPath).isFile()) return null;
    return realPath;
  } catch {
    return null;
  }
}

function markdownDocument(markdown: string): string {
  const body = new MarkdownIt({ html: false, linkify: true }).render(markdown);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:system-ui,sans-serif;line-height:1.6;max-width:48rem;margin:2rem auto;padding:0 1rem}pre{overflow:auto}</style></head><body>${body}</body></html>`;
}

/** `GET /api/artifacts/:id/source`: the artifact's local source as sandboxed HTML. */
export async function handleArtifactSourceRequest(db: IndexDb, id: string): Promise<Response> {
  const path = resolveArtifactSource(db, id);
  if (path === null) return notFound();
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return notFound();
  }
  const html = extname(path).toLowerCase() === ".md" ? markdownDocument(content) : content;
  return new Response(html, {
    status: 200,
    headers: { ...SOURCE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}
