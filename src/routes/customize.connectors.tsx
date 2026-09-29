import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { CustomizeNotice, NoSearchMatches } from "../components/customize/customize-empty";
import { ConnectorsTable } from "../components/customize/connectors-table";
import { CUSTOMIZE_SECTIONS, matchesQuery, resolveOption } from "../components/customize/sections";
import {
  customizeClaudeAiConnectorsQueryOptions,
  customizeMcpServersQueryOptions,
} from "../lib/api/customize";
import { toConnectorSlug } from "../lib/customize/mcp-tool-permissions";

export const Route = createFileRoute("/customize/connectors")({
  component: CustomizeConnectors,
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery(customizeMcpServersQueryOptions);
    void queryClient.prefetchQuery(customizeClaudeAiConnectorsQueryOptions);
  },
  head: () => ({ meta: [{ title: "Connectors · Customize" }] }),
});

const SECTION = CUSTOMIZE_SECTIONS[1]!;

function CustomizeConnectors() {
  const search = useSearch({ from: "/customize" });
  const navigate = useNavigate();
  const { data: servers, isPending } = useQuery(customizeMcpServersQueryOptions);
  const { data: claudeAi = [] } = useQuery(customizeClaudeAiConnectorsQueryOptions);

  if (isPending || servers === undefined) {
    return <p className="text-body text-t6">Loading connectors…</p>;
  }

  const searching = (search.q ?? "") !== "";
  const show = searching ? "all" : resolveOption(SECTION.filter.options, search.filter).value;
  const visibleServers = servers
    .filter((server) => show === "all" || server.enabled === (show === "enabled"))
    .filter((server) => matchesQuery(search.q, server.name, server.urlOrCommand));
  // claude.ai connectors have no local enabled state, so only "All" lists them.
  const visibleClaudeAi =
    show === "all" ? claudeAi.filter((connector) => matchesQuery(search.q, connector.name)) : [];

  if (visibleServers.length === 0 && visibleClaudeAi.length === 0) {
    return searching ? (
      <NoSearchMatches noun={SECTION.noun} />
    ) : (
      <CustomizeNotice
        title="No connectors yet"
        body="MCP servers from ~/.claude.json, project .mcp.json files and plugins appear here."
      />
    );
  }

  return (
    <ConnectorsTable
      servers={visibleServers}
      claudeAi={visibleClaudeAi}
      onView={(server) =>
        void navigate({
          to: "/customize/connectors/id/$serverId",
          params: { serverId: toConnectorSlug(server.id) },
        })
      }
    />
  );
}
