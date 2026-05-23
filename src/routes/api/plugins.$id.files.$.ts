import { createFileRoute } from "@tanstack/react-router";
import { PluginFileResponse } from "../../lib/api/plugins";

export const Route = createFileRoute("/api/plugins/$id/files/$")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string; _splat?: string } }) => {
        const { listPlugins, readPluginFileContent, parseFrontmatter } =
          await import("../../lib/plugins");
        const { extractTitleFromContent } = await import("../../lib/markdown-utils");

        const splat = params._splat ?? "";
        const pathSegments = splat ? splat.split("/") : [];

        const plugins = await listPlugins();
        const plugin = plugins.find((p) => p.id === params.id);
        if (!plugin) {
          return Response.json(PluginFileResponse.parse(null), {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          });
        }

        const content = await readPluginFileContent(plugin.installPath, ...pathSegments);
        if (!content) {
          return Response.json(PluginFileResponse.parse(null), {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          });
        }

        const { frontmatter, body } = parseFrontmatter(content);
        const lastSegment = pathSegments[pathSegments.length - 1] ?? "";
        const title = frontmatter["name"] || extractTitleFromContent(body, lastSegment);

        return Response.json(
          PluginFileResponse.parse({
            markdown: body,
            title,
            frontmatter,
          }),
          {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          },
        );
      },
    },
  },
});
