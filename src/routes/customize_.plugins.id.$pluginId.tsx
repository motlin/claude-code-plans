import {createFileRoute, Outlet} from "@tanstack/react-router";
import {PluginDetailFrame} from "../components/customize/detail-frames";
import {customizePluginDetailQueryOptions} from "../lib/api/customize";

export const Route = createFileRoute("/customize_/plugins/id/$pluginId")({
	component: PluginDetailLayout,
	loader: ({context: {queryClient}, params}) => {
		void queryClient.prefetchQuery(customizePluginDetailQueryOptions(params.pluginId));
	},
	head: () => ({meta: [{title: "Plugin · Customize"}]}),
});

/** Plugin detail shell: header and the Overview · Contents · … tabs over the active tab. */
function PluginDetailLayout() {
	const {pluginId} = Route.useParams();
	return (
		<div className="flex w-full flex-col bg-surface-1 text-body text-primary">
			<div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-8 md:px-8">
				<PluginDetailFrame pluginId={pluginId}>{() => <Outlet />}</PluginDetailFrame>
			</div>
		</div>
	);
}
