import { createFileRoute, redirect } from "@tanstack/react-router";
import { fromPluginFileSlug } from "../lib/md-slug";

/** `/plugin/<id>/<type>/<slug…>` opens the plugin's Contents tab on that file. */
export function redirectLegacyPluginFile({
  params,
}: {
  params: { id: string; type: string; _splat?: string | undefined };
}): never {
  const segments = [params.type, ...(params._splat ?? "").split("/").map(fromPluginFileSlug)];
  throw redirect({
    to: "/customize/plugins/id/$pluginId/contents",
    params: { pluginId: params.id },
    search: { file: segments.filter((segment) => segment !== "").join("/") },
    replace: true,
  });
}

export const Route = createFileRoute("/plugin/$id/$type/$")({
  beforeLoad: redirectLegacyPluginFile,
});
