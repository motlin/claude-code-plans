import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ContentsViewer } from "../components/customize/contents-viewer";
import {
  customizePluginDetailQueryOptions,
  customizePluginFileQueryOptions,
} from "../lib/api/customize";

export const Route = createFileRoute("/customize_/plugins/id/$pluginId/contents")({
  component: PluginContentsTab,
  validateSearch: z.object({ file: z.string().optional() }),
  head: () => ({ meta: [{ title: "Plugin contents · Customize" }] }),
});

/** Contents tab: README.md selected by default, or the `?file=` path. */
function PluginContentsTab() {
  const { pluginId } = Route.useParams();
  const { file } = Route.useSearch();
  const { data } = useQuery(customizePluginDetailQueryOptions(pluginId));
  if (data === undefined) return null;
  return (
    <ContentsViewer
      key={file ?? ""}
      name={`${data.plugin.name} ${data.plugin.version}`}
      tree={data.tree}
      initialFile={file}
      fileQuery={(path) => customizePluginFileQueryOptions(pluginId, path)}
    />
  );
}
