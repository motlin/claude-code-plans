import {useQuery} from "@tanstack/react-query";
import {createFileRoute} from "@tanstack/react-router";
import {ConnectorDetailHeader, ToolPermissions} from "../components/customize/connector-detail";
import {CustomizeNotice} from "../components/customize/customize-empty";
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
	const query = customizeMcpServerDetailQueryOptions(serverId);
	const {data, isPending, isError} = useQuery(query);

	return (
		<div className="flex w-full flex-col bg-surface-1 text-body text-primary">
			<div className="mx-auto flex w-full max-w-5xl flex-col px-4 pt-4 pb-8 md:px-8">
				{isPending ? (
					<p className="text-body text-t6">Loading connector…</p>
				) : isError ? (
					<CustomizeNotice
						title="Connector not found"
						body="It may have been removed or renamed since the list was loaded."
					/>
				) : (
					<>
						<ConnectorDetailHeader detail={data} />
						<ToolPermissions detail={data} detailQueryKey={query.queryKey} />
					</>
				)}
			</div>
		</div>
	);
}
