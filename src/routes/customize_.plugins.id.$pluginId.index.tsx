import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PluginOverview } from "../components/customize/plugin-detail";
import { customizePluginDetailQueryOptions } from "../lib/api/customize";

export const Route = createFileRoute("/customize_/plugins/id/$pluginId/")({
  component: PluginOverviewTab,
});

function PluginOverviewTab() {
  const { pluginId } = Route.useParams();
  const { data } = useQuery(customizePluginDetailQueryOptions(pluginId));
  return data === undefined ? null : <PluginOverview detail={data} />;
}
