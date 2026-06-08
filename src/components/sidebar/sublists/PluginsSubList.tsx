import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { pluginsQueryOptions, userCommandsQueryOptions } from "../../../lib/api/plugins";
import { toMdSlug } from "../../../lib/md-slug";
import { LoadingBars } from "../primitives/LoadingBars";

type SidebarItem =
  | { type: "plugin"; id: string; label: string }
  | { type: "command"; source: string; filename: string; label: string };

export function PluginsSubList() {
  const { data: plugins } = useQuery(pluginsQueryOptions);
  const { data: commands } = useQuery(userCommandsQueryOptions);

  if (plugins === undefined || commands === undefined) {
    return (
      <div className="pl-10">
        <LoadingBars />
      </div>
    );
  }

  const items: SidebarItem[] = [];
  for (const p of plugins) {
    items.push({ type: "plugin", id: p.id, label: p.name });
  }
  for (const g of commands) {
    for (const c of g.commands) {
      items.push({
        type: "command",
        source: g.source,
        filename: c.filename,
        label: c.name,
      });
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="pl-10">
      {items.map((item) => {
        if (item.type === "plugin") {
          return (
            <Link
              key={item.id}
              to="/plugins"
              hash={item.id}
              className="mb-px block truncate rounded-[4px] px-2 py-1 text-xs text-text-500 no-underline transition-colors hover:bg-bg-300/50 hover:text-text-200"
            >
              {item.label}
            </Link>
          );
        }
        return (
          <Link
            key={`${item.source}/${item.filename}`}
            to="/command/$source/$filename"
            params={{ source: item.source, filename: toMdSlug(item.filename) }}
            className="mb-px block truncate rounded-[4px] px-2 py-1 text-xs text-text-500 no-underline transition-colors hover:bg-bg-300/50 hover:text-text-200"
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
