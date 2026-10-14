import {noop} from "@tanstack/react-query";
import {createFileRoute, Outlet} from "@tanstack/react-router";
import {PluginDetailFrame} from "../components/customize/detail-frames";
import {PluginDetailPage} from "../components/customize/plugin-detail";
import {customizePluginDetailQueryOptions} from "../lib/api/customize";

export const Route = createFileRoute("/customize_/plugins/id/$pluginId")({
	component: PluginDetailLayout,
	loader: ({context: {queryClient}, params}) => {
		void queryClient.query(customizePluginDetailQueryOptions(params.pluginId)).catch(noop);
	},
	head: () => ({meta: [{title: "Plugin · Customize"}]}),
	staticData: {pageGutter: "tight"},
});

/** Plugin detail shell: header and the Overview · Contents · … tabs over the active tab. */
function PluginDetailLayout() {
	const {pluginId} = Route.useParams();
	return (
		<PluginDetailPage>
			<PluginDetailFrame pluginId={pluginId}>{() => <Outlet />}</PluginDetailFrame>
		</PluginDetailPage>
	);
}
