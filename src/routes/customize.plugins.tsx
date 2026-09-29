import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { Puzzle } from "lucide-react";
import { CustomizeNotice } from "../components/customize/customize-empty";
import { CustomizeList } from "../components/customize/customize-list";
import { CUSTOMIZE_SECTIONS, matchesQuery, resolveOption } from "../components/customize/sections";
import { groupPluginsByMarketplace, pluginsQueryOptions } from "../lib/api/plugins";

export const Route = createFileRoute("/customize/plugins")({
  component: CustomizePlugins,
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery(pluginsQueryOptions);
  },
  head: () => ({ meta: [{ title: "Plugins · Customize" }] }),
});

const SECTION = CUSTOMIZE_SECTIONS[2]!;

function CustomizePlugins() {
  const search = useSearch({ from: "/customize" });
  const { data: plugins, isPending } = useQuery(pluginsQueryOptions);

  if (search.view === "discover") {
    return (
      <CustomizeNotice title="Discover" body="Browsing the plugin catalog is not available yet." />
    );
  }
  if (isPending || plugins === undefined) {
    return <p className="text-body text-t6">Loading plugins…</p>;
  }

  const searching = (search.q ?? "") !== "";
  const show = searching ? "all" : resolveOption(SECTION.filter.options, search.filter).value;
  const sort = resolveOption(SECTION.sort ?? [], search.sort).value;
  const marketplaces = groupPluginsByMarketplace(
    plugins.filter((plugin) => matchesQuery(search.q, plugin.name, plugin.description)),
  ).filter((group) => show === "all" || group.isOfficial === (show === "official"));
  const byName = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);
  const marketplaceGroups = marketplaces.map((group) => ({
    key: group.marketplace.id,
    title: group.marketplace.displayName,
    items: group.plugins
      .map((plugin) => ({
        key: plugin.id,
        title: plugin.name,
        source: `from ${group.marketplace.displayName}`,
        subtitle: plugin.description,
        meta: plugin.version,
      }))
      .sort(byName),
  }));
  const groups =
    sort === "name"
      ? [
          {
            key: "all",
            title: "All plugins",
            items: marketplaceGroups.flatMap((group) => group.items).sort(byName),
          },
        ]
      : marketplaceGroups;

  return (
    <CustomizeList
      icon={Puzzle}
      noun={SECTION.noun}
      searching={searching}
      groups={groups}
      empty={
        <CustomizeNotice
          title="No plugins yet"
          body="Plugins installed with `claude plugin install` appear here."
        />
      }
    />
  );
}
