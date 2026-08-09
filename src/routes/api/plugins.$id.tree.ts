import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { PluginTreeResponse } from "../../lib/api/plugins";

export const Route = createFileRoute("/api/plugins/$id/tree")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params }: { params: { id: string } }) => {
        const { listPlugins, scanPluginTree } = await import("../../lib/plugins");
        const plugins = await listPlugins();
        const plugin = plugins.find((p) => p.id === params.id);
        if (!plugin) {
          return Response.json(PluginTreeResponse.parse(null), {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          });
        }
        const tree = await scanPluginTree(plugin.installPath);
        return Response.json(PluginTreeResponse.parse(tree), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
