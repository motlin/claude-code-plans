import { createFileRoute } from "@tanstack/react-router";
import { UserCommandFileResponse } from "../../lib/api/plugins";

export const Route = createFileRoute("/api/plugins/user-commands/$source/$filename")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { source: string; filename: string } }) => {
        const { readUserCommandContent } = await import("../../lib/plugins");
        const { extractTitleFromContent } = await import("../../lib/markdown-utils");
        const { decodeProjectDir } = await import("../../lib/memory");

        const content = await readUserCommandContent(params.source, params.filename);
        if (!content) {
          return Response.json(UserCommandFileResponse.parse(null), {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          });
        }

        const title = extractTitleFromContent(content, params.filename);
        const sourceName = params.source === "global" ? "Global" : decodeProjectDir(params.source);

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
    },
  },
});
