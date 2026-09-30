import {useQuery} from "@tanstack/react-query";
import {createFileRoute} from "@tanstack/react-router";
import {PluginFiles} from "../components/customize/plugin-detail";
import {customizePluginDetailQueryOptions} from "../lib/api/customize";

export const Route = createFileRoute("/customize_/plugins/id/$pluginId/agents")({
	component: PluginAgentsTab,
});

function PluginAgentsTab() {
	const {pluginId} = Route.useParams();
	const {data} = useQuery(customizePluginDetailQueryOptions(pluginId));
	return data === undefined ? null : <PluginFiles plugin={data.plugin} kind="agents" />;
}
