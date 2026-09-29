import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { Server } from "lucide-react";
import { CustomizeNotice } from "../components/customize/customize-empty";
import { CustomizeList, groupBy } from "../components/customize/customize-list";
import { CUSTOMIZE_SECTIONS, matchesQuery, resolveOption } from "../components/customize/sections";
import { customizeMcpServersQueryOptions, type McpScope } from "../lib/api/customize";

export const Route = createFileRoute("/customize/connectors")({
  component: CustomizeConnectors,
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery(customizeMcpServersQueryOptions);
  },
  head: () => ({ meta: [{ title: "Connectors · Customize" }] }),
});

const SECTION = CUSTOMIZE_SECTIONS[1]!;

const SCOPE_LABEL = {
  user: "User",
  local: "Local",
  project: "Project",
  plugin: "Plugin",
} as const satisfies Record<McpScope, string>;

function CustomizeConnectors() {
  const search = useSearch({ from: "/customize" });
  const { data: servers, isPending } = useQuery(customizeMcpServersQueryOptions);

  if (isPending || servers === undefined) {
    return <p className="text-body text-t6">Loading connectors…</p>;
  }

  const searching = (search.q ?? "") !== "";
  const show = searching ? "all" : resolveOption(SECTION.filter.options, search.filter).value;
  const visible = servers
    .filter((server) => show === "all" || server.enabled === (show === "enabled"))
    .filter((server) => matchesQuery(search.q, server.name, server.urlOrCommand));

  return (
    <CustomizeList
      icon={Server}
      noun={SECTION.noun}
      searching={searching}
      groups={groupBy(
        visible,
        (server) => ({ key: server.scope, title: SCOPE_LABEL[server.scope] }),
        (server) => ({
          key: server.id,
          title: server.name,
          source: server.transport,
          subtitle: server.urlOrCommand,
          meta: server.enabled ? "Enabled" : "Disabled",
        }),
      )}
      empty={
        <CustomizeNotice
          title="No connectors yet"
          body="MCP servers from ~/.claude.json, project .mcp.json files and plugins appear here."
        />
      }
    />
  );
}
