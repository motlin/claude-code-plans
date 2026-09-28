import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { UserCommandFileResponse } from "../../lib/api/plugins";
import { fromMdSlug } from "../../lib/md-slug";

export const Route = createFileRoute("/api/plugins/user-commands/$source/$filename")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params }: { params: { source: string; filename: string } }) => {
        const { readUserCommandContent } = await import("../../lib/plugins");
        const { getDb } = await import("../../lib/db");
        const { listProjectCommandSourcesFromDb } = await import("../../lib/db/queries");
        const { extractTitleFromContent } = await import("../../lib/markdown-utils");
        const { decodeProjectDir } = await import("../../lib/memory");

        const filename = fromMdSlug(params.filename);
        const projectPath =
          params.source === "global"
            ? null
            : (listProjectCommandSourcesFromDb(getDb().index).find(
                (project) => project.id === params.source,
              )?.projectPath ?? null);
        const content = await readUserCommandContent(params.source, filename, projectPath);
        if (!content) {
          return Response.json(UserCommandFileResponse.parse(null), {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          });
        }

        const title = extractTitleFromContent(content, filename);
        const sourceName =
          params.source === "global"
            ? "Global"
            : decodeProjectDir(params.source, projectPath ?? undefined);

        return Response.json(
          UserCommandFileResponse.parse({
            markdown: content,
            title,
            sourceName,
          }),
          {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          },
        );
      },
    }),
  },
});
