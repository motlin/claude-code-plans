import { createFileRoute } from "@tanstack/react-router";
import {
  MemoryDeleteResponse,
  MemoryDetailResponse,
  MemorySaveResponse,
} from "../../lib/api/memories";
import { fromMdSlug } from "../../lib/md-slug";
import { rejectCrossSite } from "../../lib/same-origin-guard";

export const Route = createFileRoute("/api/projects/$id/memories/$filename")({
  server: {
    handlers: {
      GET: async ({
        params,
        request,
      }: {
        params: { id: string; filename: string };
        request: Request;
      }) => {
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const { stat } = await import("node:fs/promises");
        const { readMemory, decodeProjectDir } = await import("../../lib/memory");

        const projectsDir = join(homedir(), ".claude", "projects");
        const filename = fromMdSlug(params.filename);
        const filePath = join(projectsDir, params.id, "memory", filename);

        let mtime: Date | null = null;
        try {
          const fileStat = await stat(filePath);
          mtime = fileStat.mtime;
        } catch {
          // missing file — fall through to readMemory which returns null
        }

        if (mtime) {
          const ifModifiedSince = request.headers.get("If-Modified-Since");
          if (ifModifiedSince) {
            const since = new Date(ifModifiedSince).getTime();
            const mtimeFloor = Math.floor(mtime.getTime() / 1000) * 1000;
            if (!Number.isNaN(since) && since >= mtimeFloor) {
              return new Response(null, {
                status: 304,
                headers: {
                  "Cache-Control": "private, max-age=0, must-revalidate",
                  "Last-Modified": mtime.toUTCString(),
                },
              });
            }
          }
        }

        const content = await readMemory(projectsDir, params.id, filename);
        if (content === null) {
          return Response.json(MemoryDetailResponse.parse(null), {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          });
        }

        const projectName = decodeProjectDir(params.id);
        const headers: Record<string, string> = {
          "Cache-Control": "private, max-age=0, must-revalidate",
        };
        if (mtime) {
          headers["Last-Modified"] = mtime.toUTCString();
        }

        return Response.json(
          MemoryDetailResponse.parse({
            markdown: content,
            mtime: mtime ? mtime.toISOString() : null,
            projectName,
          }),
          { headers },
        );
      },
      PUT: async ({
        params,
        request,
      }: {
        params: { id: string; filename: string };
        request: Request;
      }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const { writeMemory } = await import("../../lib/memory");
        const projectsDir = join(homedir(), ".claude", "projects");
        const content = await request.text();
        const ok = await writeMemory(projectsDir, params.id, fromMdSlug(params.filename), content);
        if (!ok) {
          return new Response("Invalid path", { status: 400 });
        }
        return Response.json(MemorySaveResponse.parse({ ok }), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
      DELETE: async ({
        params,
        request,
      }: {
        params: { id: string; filename: string };
        request: Request;
      }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const { deleteMemory } = await import("../../lib/memory");
        const projectsDir = join(homedir(), ".claude", "projects");
        const ok = await deleteMemory(projectsDir, params.id, fromMdSlug(params.filename));
        return Response.json(MemoryDeleteResponse.parse({ ok }), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
