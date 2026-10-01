import {createFileRoute, useSearch} from "@tanstack/react-router";
import {prefetchCustomizeSection} from "../components/customize/section-prefetch";
import {PluginsSection} from "../components/customize/section-views";

export const Route = createFileRoute("/customize/plugins")({
	component: CustomizePlugins,
	loader: ({context: {queryClient}}) => prefetchCustomizeSection(queryClient, "plugins"),
	head: () => ({meta: [{title: "Plugins · Customize"}]}),
});

function CustomizePlugins() {
	const search = useSearch({from: "/customize"});
	return <PluginsSection search={search} />;
}
