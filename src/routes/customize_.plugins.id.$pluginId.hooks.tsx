import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PluginHooks } from "../components/customize/plugin-detail";
import { customizePluginDetailQueryOptions } from "../lib/api/customize";

export const Route = createFileRoute("/customize_/plugins/id/$pluginId/hooks")({
  component: PluginHooksTab,
});

function PluginHooksTab() {
  const { pluginId } = Route.useParams();
  const { data } = useQuery(customizePluginDetailQueryOptions(pluginId));
  return data === undefined ? null : <PluginHooks hooks={data.hooks} />;
}
