import {createFileRoute, useSearch} from "@tanstack/react-router";
import {prefetchCustomizeSection} from "../components/customize/section-prefetch";
import {ConnectorsSection} from "../components/customize/section-views";

export const Route = createFileRoute("/customize/connectors")({
	component: CustomizeConnectors,
	loader: ({context: {queryClient}}) => prefetchCustomizeSection(queryClient, "connectors"),
	head: () => ({meta: [{title: "Connectors · Customize"}]}),
});

function CustomizeConnectors() {
	const search = useSearch({from: "/customize"});
	return <ConnectorsSection search={search} />;
}
