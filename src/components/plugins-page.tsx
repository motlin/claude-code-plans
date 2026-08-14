import { Link, useHydrated, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  groupPluginsByMarketplace,
  pluginTreeQueryOptions,
  pluginsQueryOptions,
  userCommandsQueryOptions,
  type PluginInfoData,
  type PluginMarketplaceGroup,
  type UserCommandGroupData,
} from "../lib/api/plugins";
import {
  ChevronRight,
  ChevronDown,
  Blocks,
  Terminal,
  Bot,
  Sparkles,
  BookOpen,
  Store,
  FolderTree,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileTree } from "./file-tree";
import { toMdSlug, toPluginFileSlug } from "../lib/md-slug";
import { ListPageHeader } from "./list-page-header";
import { PluginVersion } from "./plugin-version";

function MarketplaceGroup({
  group,
  defaultExpanded,
  hashTargetPluginId,
}: {
  group: PluginMarketplaceGroup;
  defaultExpanded: boolean;
  hashTargetPluginId: string | null;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const pluginCount = group.plugins.length;
  const containsHashTarget = group.plugins.some((plugin) => plugin.id === hashTargetPluginId);

  useEffect(() => {
    if (containsHashTarget) {
      setExpanded(true);
    }
  }, [containsHashTarget]);

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <Store className="h-4 w-4 shrink-0 text-t6" />
        <div className="min-w-0 flex-1">
          <span className="font-semibold text-sm">{group.marketplace.displayName}</span>
          <span className="ml-2 text-xs text-t6">
            {pluginCount} plugin{pluginCount !== 1 && "s"}
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-t6" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-t6" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-subtle px-3 pb-3 pt-2 space-y-2">
          {group.plugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              isHashTarget={plugin.id === hashTargetPluginId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type PluginTab = "contents" | "files";

export function PluginCard({
  plugin,
  isHashTarget,
}: {
  plugin: PluginInfoData;
  isHashTarget: boolean;
}) {
  const [expanded, setExpanded] = useState(isHashTarget);
  const [activeTab, setActiveTab] = useState<PluginTab>("contents");
  const [treeEnabled, setTreeEnabled] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const totalItems = plugin.agents.length + plugin.commands.length + plugin.skills.length;
  const panelId = `${plugin.id}-contents`;

  const treeQuery = useQuery({
    ...pluginTreeQueryOptions(plugin.id),
    enabled: treeEnabled,
  });

  function switchTab(tab: PluginTab) {
    setActiveTab(tab);
    if (tab === "files") {
      setTreeEnabled(true);
    }
  }

  useEffect(() => {
    if (isHashTarget) {
      setExpanded(true);
      cardRef.current?.scrollIntoView({ block: "center" });
    }
  }, [isHashTarget]);

  return (
    <div
      ref={cardRef}
      id={plugin.id}
      className="rounded-lg border border-border transition-colors hover:bg-surface-0/30"
    >
      <button
        type="button"
        aria-controls={panelId}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <Blocks className="mt-0.5 h-5 w-5 shrink-0 text-t6" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{plugin.name}</span>
            <PluginVersion version={plugin.version} versionKind={plugin.versionKind} />
          </div>
          {plugin.description && (
            <p className="mt-0.5 text-sm text-t6 line-clamp-2">{plugin.description}</p>
          )}
          <div className="mt-2 flex gap-3 text-xs text-t6">
            {plugin.agents.length > 0 && (
              <span className="flex items-center gap-1">
                <Bot className="h-3 w-3" />
                {plugin.agents.length} agent{plugin.agents.length !== 1 && "s"}
              </span>
            )}
            {plugin.commands.length > 0 && (
              <span className="flex items-center gap-1">
                <Terminal className="h-3 w-3" />
                {plugin.commands.length} command
                {plugin.commands.length !== 1 && "s"}
              </span>
            )}
            {plugin.skills.length > 0 && (
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                {plugin.skills.length} skill{plugin.skills.length !== 1 && "s"}
              </span>
            )}
          </div>
        </div>
        <ChevronRight
          className="mt-1 h-4 w-4 shrink-0 text-t6 transition-transform duration-200"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-subtle px-4 pb-3 pt-2">
          <div className="mb-2 flex gap-1">
            <button
              type="button"
              onClick={() => switchTab("contents")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                activeTab === "contents"
                  ? "bg-fill-control text-primary"
                  : "text-t6 hover:bg-surface-0/50 hover:text-secondary"
              }`}
            >
              <Blocks className="h-3 w-3" />
              Contents
            </button>
            <button
              type="button"
              onClick={() => switchTab("files")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                activeTab === "files"
                  ? "bg-fill-control text-primary"
                  : "text-t6 hover:bg-surface-0/50 hover:text-secondary"
              }`}
            >
              <FolderTree className="h-3 w-3" />
              Files
            </button>
          </div>

          {activeTab === "contents" && totalItems > 0 && (
            <>
              {plugin.agents.length > 0 && (
                <ContentSection
                  label="Agents"
                  icon={<Bot className="h-3 w-3" />}
                  items={plugin.agents.map((a) => ({
                    label: a.name,
                    to: "/plugin/$id/$type/$",
                    params: {
                      id: plugin.id,
                      type: "agents",
                      _splat: toPluginFileSlug(a.filename),
                    },
                  }))}
                />
              )}
              {plugin.commands.length > 0 && (
                <ContentSection
                  label="Commands"
                  icon={<Terminal className="h-3 w-3" />}
                  items={plugin.commands.map((c) => ({
                    label: c.name,
                    to: "/plugin/$id/$type/$",
                    params: {
                      id: plugin.id,
                      type: "commands",
                      _splat: toPluginFileSlug(c.filename),
                    },
                  }))}
                />
              )}
              {plugin.skills.length > 0 && (
                <ContentSection
                  label="Skills"
                  icon={<Sparkles className="h-3 w-3" />}
                  items={plugin.skills.map((s) => ({
                    label: s.name,
                    to: "/plugin/$id/$type/$",
                    params: {
                      id: plugin.id,
                      type: "skills",
                      _splat: [s.dirname, "SKILL.md"].map(toPluginFileSlug).join("/"),
                    },
                    children: [
                      ...s.references.map((r) => ({
                        label: r.name,
                        to: "/plugin/$id/$type/$" as const,
                        params: {
                          id: plugin.id,
                          type: "skills",
                          _splat: [s.dirname, "references", r.filename]
                            .map(toPluginFileSlug)
                            .join("/"),
                        },
                      })),
                      ...s.examples.map((e) => ({
                        label: e.name,
                        to: "/plugin/$id/$type/$" as const,
                        params: {
                          id: plugin.id,
                          type: "skills",
                          _splat: [s.dirname, "examples", e.filename]
                            .map(toPluginFileSlug)
                            .join("/"),
                        },
                      })),
                    ],
                  }))}
                />
              )}
            </>
          )}
          {activeTab === "contents" && totalItems === 0 && (
            <p className="py-2 text-xs text-t6">No agents, commands, or skills found.</p>
          )}

          {activeTab === "files" && (
            <div className="mt-1">
              {treeQuery.isLoading && (
                <div className="space-y-1.5 py-2">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-fill-ghost-hover" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-fill-ghost-hover" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-fill-ghost-hover" />
                </div>
              )}
              {!treeQuery.isLoading && treeQuery.data && (
                <FileTree tree={treeQuery.data} pluginId={plugin.id} />
              )}
              {!treeQuery.isLoading && treeQuery.isFetched && !treeQuery.data && (
                <p className="py-2 text-xs text-t6">Could not read plugin directory.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContentSection({
  label,
  icon,
  items,
}: {
  label: string;
  icon: React.ReactNode;
  items: Array<{
    label: string;
    to: string;
    params: Record<string, string>;
    children?: Array<{
      label: string;
      to: string;
      params: Record<string, string>;
    }>;
  }>;
}) {
  return (
    <div className="mt-2 first:mt-0">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-t6">
        {icon}
        {label}
      </div>
      <div className="mt-1 space-y-px">
        {items.map((item) => (
          <div key={item.params["_splat"] || item.label}>
            <Link
              to={item.to as string}
              params={item.params}
              className="block rounded-md px-2 py-1.5 text-sm text-secondary no-underline transition-colors hover:bg-surface-0/50"
            >
              {item.label}
            </Link>
            {item.children && item.children.length > 0 && (
              <div className="pl-4">
                {item.children.map((child) => (
                  <Link
                    key={child.params["_splat"] || child.label}
                    to={child.to as string}
                    params={child.params}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-t6 no-underline transition-colors hover:bg-surface-0/50 hover:text-secondary"
                  >
                    <BookOpen className="h-3 w-3 shrink-0" />
                    {child.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PluginsPageSkeleton() {
  return (
    <div>
      <header>
        <h1 className="text-lg font-semibold">Plugins</h1>
        <div className="mt-2 h-4 w-24 animate-pulse rounded bg-fill-ghost-hover" />
      </header>
      <div className="mt-6 space-y-4" data-testid="plugins-skeleton">
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="flex items-center gap-3 rounded-lg border border-border px-4 py-3"
          >
            <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-fill-ghost-hover" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-fill-ghost-hover" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PluginsPage() {
  // Plain `useQuery` (not suspense) so the app shell stays painted and this
  // page can show its own skeleton while the large plugins payload loads.
  const pluginsQuery = useQuery(pluginsQueryOptions);
  const userCommandsQuery = useQuery(userCommandsQueryOptions);
  const plugins = pluginsQuery.data;
  const userCommands = userCommandsQuery.data;
  const groups = useMemo(() => (plugins ? groupPluginsByMarketplace(plugins) : []), [plugins]);
  const locationHash = useLocation({ select: (location) => location.hash });
  const hydrated = useHydrated();
  const hashTargetPluginId = hydrated && locationHash ? locationHash : null;

  if (pluginsQuery.isError) throw pluginsQuery.error;
  if (userCommandsQuery.isError) throw userCommandsQuery.error;
  if (!plugins || !userCommands) return <PluginsPageSkeleton />;

  const pluginCount = plugins.length;
  const commandGroupCount = userCommands.length;

  return (
    <div>
      <ListPageHeader title="Plugins" count={pluginCount} itemLabel="plugin" />

      {groups.length > 0 && (
        <div className="mt-6 space-y-4">
          {groups.map((group) => (
            <MarketplaceGroup
              key={group.marketplace.id}
              group={group}
              defaultExpanded={!group.isOfficial}
              hashTargetPluginId={hashTargetPluginId}
            />
          ))}
        </div>
      )}

      {commandGroupCount > 0 && (
        <div className="mt-8">
          <h2 className="text-base font-semibold">User Commands</h2>
          {userCommands.map((group: UserCommandGroupData) => (
            <div key={group.source} className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-t6">
                {group.sourceName}
              </h3>
              <ul className="mt-2 space-y-1">
                {group.commands.map((cmd) => (
                  <li key={cmd.filename}>
                    <Link
                      to="/command/$source/$filename"
                      params={{ source: group.source, filename: toMdSlug(cmd.filename) }}
                      className="block rounded-md border border-border px-4 py-3 text-sm font-medium text-secondary no-underline transition-colors hover:bg-surface-0/50"
                    >
                      {cmd.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {pluginCount === 0 && commandGroupCount === 0 && (
        <p className="mt-4 text-t6">No plugins or commands found.</p>
      )}
    </div>
  );
}
