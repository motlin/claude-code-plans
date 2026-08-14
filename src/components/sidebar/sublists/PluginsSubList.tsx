import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import {
  groupPluginsByMarketplace,
  pluginsQueryOptions,
  userCommandsQueryOptions,
  type PluginMarketplaceGroup,
  type UserCommandGroupData,
} from "../../../lib/api/plugins";
import { toMdSlug } from "../../../lib/md-slug";
import { LoadingBars } from "../primitives/LoadingBars";

export function PluginsSubList() {
  const { data: plugins } = useQuery(pluginsQueryOptions);
  const { data: commands } = useQuery(userCommandsQueryOptions);
  const marketplaceGroups = useMemo(
    () => (plugins ? groupPluginsByMarketplace(plugins) : undefined),
    [plugins],
  );

  if (marketplaceGroups === undefined || commands === undefined) {
    return (
      <div className="pl-10">
        <LoadingBars />
      </div>
    );
  }

  if (marketplaceGroups.length === 0 && commands.length === 0) return null;

  return (
    <div className="pl-10">
      {marketplaceGroups.map((group) => (
        <MarketplaceSubListGroup key={group.marketplace.id} group={group} />
      ))}
      {commands.length > 0 && (
        <div className={marketplaceGroups.length > 0 ? "mt-2" : undefined}>
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-t6">
            User Commands
          </div>
          {commands.map((group) => (
            <CommandSubListGroup key={group.source} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

function MarketplaceSubListGroup({ group }: { group: PluginMarketplaceGroup }) {
  const [isExpanded, setIsExpanded] = useState(!group.isOfficial);

  return (
    <div>
      <GroupButton
        label={group.marketplace.displayName}
        count={group.plugins.length}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((expanded) => !expanded)}
      />
      {isExpanded &&
        group.plugins.map((plugin) => (
          <Link
            key={plugin.id}
            to="/plugins"
            hash={plugin.id}
            className="mb-px block truncate rounded-r3 py-1 pl-5 pr-2 text-xs text-t6 no-underline transition-colors hover:bg-fill-ghost-hover hover:text-secondary"
          >
            {plugin.name}
          </Link>
        ))}
    </div>
  );
}

function CommandSubListGroup({ group }: { group: UserCommandGroupData }) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div>
      <GroupButton
        label={group.sourceName}
        count={group.commands.length}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((expanded) => !expanded)}
      />
      {isExpanded &&
        group.commands.map((command) => (
          <Link
            key={command.filename}
            to="/command/$source/$filename"
            params={{ source: group.source, filename: toMdSlug(command.filename) }}
            className="mb-px block truncate rounded-r3 py-1 pl-5 pr-2 text-xs text-t6 no-underline transition-colors hover:bg-fill-ghost-hover hover:text-secondary"
          >
            {command.name}
          </Link>
        ))}
    </div>
  );
}

function GroupButton({
  label,
  count,
  isExpanded,
  onToggle,
}: {
  label: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mb-px flex w-full items-center gap-1 rounded-r3 px-2 py-1 text-xs text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-secondary"
    >
      <ChevronRight
        className="h-2.5 w-2.5 shrink-0 transition-transform duration-200"
        style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
      />
      <span className="truncate font-medium">{label}</span>
      <span className="ml-auto shrink-0 text-[10px] opacity-60">{count}</span>
    </button>
  );
}
