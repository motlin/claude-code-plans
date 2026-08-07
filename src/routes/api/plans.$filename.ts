import { createFileRoute } from "@tanstack/react-router";
import { PlanDetailResponse } from "../../lib/api/plans";
import { fromMdSlug } from "../../lib/md-slug";
import { rejectCrossSite } from "../../lib/same-origin-guard";

/**
 * Returns `true` when an `If-Modified-Since` header value indicates the
 * client's cached copy is up-to-date relative to the file's `mtime`.
 *
 * HTTP `Last-Modified`/`If-Modified-Since` have one-second precision, so
 * the comparison is performed against `mtime` floored to the nearest
 * second. Returns `false` when the header is missing, unparseable, or
 * older than the floored mtime.
 */
export function isPlanNotModified(ifModifiedSince: string | null, mtime: Date): boolean {
  if (!ifModifiedSince) return false;
  const since = new Date(ifModifiedSince).getTime();
  if (Number.isNaN(since)) return false;
  const mtimeFloor = Math.floor(mtime.getTime() / 1000) * 1000;
  return since >= mtimeFloor;
}

export const Route = createFileRoute("/api/plans/$filename")({
  server: {
    handlers: {
      GET: async ({ params, request }: { params: { filename: string }; request: Request }) => {
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const { stat } = await import("node:fs/promises");
        const { resolveMarkdownFilePath } = await import("../../lib/markdown-file-path");
        const { readPlan } = await import("../../lib/plans");
        const { extractTitleFromContent } = await import("../../lib/markdown-utils");

        const plansDir = join(homedir(), ".claude", "plans");
        const filename = fromMdSlug(params.filename);
        const filePath = resolveMarkdownFilePath(plansDir, filename);
        if (filePath === null) {
          return new Response("Not Found", { status: 404 });
        }

        let mtime: Date | null = null;
        try {
          const fileStat = await stat(filePath);
          mtime = fileStat.mtime;
        } catch {
          // missing file — fall through to readPlan which returns null
        }

        if (mtime) {
          if (isPlanNotModified(request.headers.get("If-Modified-Since"), mtime)) {
            return new Response(null, {
              status: 304,
              headers: {
                "Cache-Control": "private, max-age=0, must-revalidate",
                "Last-Modified": mtime.toUTCString(),
              },
            });
          }
        }

        const markdown = await readPlan(plansDir, filename);
        if (markdown == null || mtime == null) {
          return new Response("Not Found", { status: 404 });
        }

        const title = extractTitleFromContent(markdown, filename);

        const headers: Record<string, string> = {
          "Cache-Control": "private, max-age=0, must-revalidate",
          "Last-Modified": mtime.toUTCString(),
        };

        return Response.json(
          PlanDetailResponse.parse({
            markdown,
            mtime: mtime.toISOString(),
            title,
          }),
          { headers },
        );
      },
      PUT: async ({ params, request }: { params: { filename: string }; request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const { writePlan } = await import("../../lib/plans");
        const { extractTitleFromContent } = await import("../../lib/markdown-utils");

        const plansDir = join(homedir(), ".claude", "plans");
        const filename = fromMdSlug(params.filename);
        const markdown = await request.text();
        const ok = await writePlan(plansDir, filename, markdown);
        if (!ok) {
          return new Response("Not Found", { status: 404 });
        }

        const title = extractTitleFromContent(markdown, filename);

        return Response.json(
          {
            title,
          },
          {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          },
        );
      },
    },
  },
});
