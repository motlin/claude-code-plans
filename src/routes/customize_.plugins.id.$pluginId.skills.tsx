import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PluginSkills } from "../components/customize/plugin-detail";
import { customizePluginDetailQueryOptions } from "../lib/api/customize";

export const Route = createFileRoute("/customize_/plugins/id/$pluginId/skills")({
  component: PluginSkillsTab,
});

function PluginSkillsTab() {
  const { pluginId } = Route.useParams();
  const { data } = useQuery(customizePluginDetailQueryOptions(pluginId));
  return data === undefined ? null : <PluginSkills plugin={data.plugin} />;
}
