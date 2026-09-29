import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PluginConnectors } from "../components/customize/plugin-detail";
import { customizePluginDetailQueryOptions } from "../lib/api/customize";

export const Route = createFileRoute("/customize_/plugins/id/$pluginId/connectors")({
  component: PluginConnectorsTab,
});

function PluginConnectorsTab() {
  const { pluginId } = Route.useParams();
  const { data } = useQuery(customizePluginDetailQueryOptions(pluginId));
  return data === undefined ? null : <PluginConnectors detail={data} />;
}
