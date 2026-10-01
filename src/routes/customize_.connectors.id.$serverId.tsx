import {createFileRoute} from "@tanstack/react-router";
import {ConnectorDetailFrame} from "../components/customize/detail-frames";
import {customizeMcpServerDetailQueryOptions} from "../lib/api/customize";

export const Route = createFileRoute("/customize_/connectors/id/$serverId")({
	component: ConnectorDetailPage,
	loader: ({context: {queryClient}, params}) => {
		void queryClient.prefetchQuery(customizeMcpServerDetailQueryOptions(params.serverId));
	},
	head: () => ({meta: [{title: "Connector · Customize"}]}),
});

/** Local MCP server detail: header, copyable URL or command, and tool permissions. */
function ConnectorDetailPage() {
	const {serverId} = Route.useParams();
	return (
		<div className="flex w-full flex-col bg-surface-1 text-body text-primary">
			<div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-8 md:px-8">
				<ConnectorDetailFrame serverId={serverId} />
			</div>
		</div>
	);
}
