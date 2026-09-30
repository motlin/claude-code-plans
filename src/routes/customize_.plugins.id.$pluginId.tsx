import {useQuery} from "@tanstack/react-query";
import {createFileRoute, Outlet} from "@tanstack/react-router";
import {CustomizeNotice} from "../components/customize/customize-empty";
import {PluginDetailHeader} from "../components/customize/plugin-detail";
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
	const {data, isPending, isError} = useQuery(customizePluginDetailQueryOptions(pluginId));

	return (
		<div className="flex w-full flex-col bg-surface-1 text-body text-primary">
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pt-4 pb-8 md:px-8">
				{isPending ? (
					<p className="text-body text-t6">Loading plugin…</p>
				) : isError ? (
					<CustomizeNotice
						title="Plugin not found"
						body="It may have been uninstalled since the list was loaded."
					/>
				) : (
					<>
						<PluginDetailHeader detail={data} />
						<Outlet />
					</>
				)}
			</div>
		</div>
	);
}
