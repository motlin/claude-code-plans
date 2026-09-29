import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Bot, Plug, Puzzle, Scroll, SquareSlash } from "lucide-react";
import type { ReactNode } from "react";
import {
  customizeSettingsTogglesQueryOptions,
  isPluginEnabled,
  type PluginDetail,
  type PluginHookRow,
} from "../../lib/api/customize";
import type { PluginInfoData } from "../../lib/api/plugins";
import { toConnectorSlug } from "../../lib/customize/mcp-tool-permissions";
import { PluginVersion } from "../plugin-version";
import { ScopeBadge, transportLabel } from "./connectors-table";
import { IconTile } from "./icon-tile";
import { ListRow } from "./list-row";
import { PluginRowActions } from "./plugin-row-actions";
import { type PluginTabId, pluginDetailTabs, pluginNamespace } from "./plugin-view";

const TAB_CLASS =
  "relative inline-flex h-10 items-center gap-1 border-b-2 border-transparent px-1 text-body font-medium text-t6 no-underline hover:text-secondary aria-[current=page]:border-primary aria-[current=page]:text-primary";

const TAB_TO = {
  overview: "/customize/plugins/id/$pluginId",
  contents: "/customize/plugins/id/$pluginId/contents",
  skills: "/customize/plugins/id/$pluginId/skills",
  connectors: "/customize/plugins/id/$pluginId/connectors",
  agents: "/customize/plugins/id/$pluginId/agents",
  commands: "/customize/plugins/id/$pluginId/commands",
  hooks: "/customize/plugins/id/$pluginId/hooks",
} as const satisfies Record<PluginTabId, string>;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Upstream plugin detail header: "← Plugins", 44px tile, H2 name over
 * "by <author> · <version> · N skills", the Enable/Disable kebab, then the
 * underline tabs with their " · N" counts.
 */
export function PluginDetailHeader({ detail }: { detail: PluginDetail }) {
  const { plugin } = detail;
  const { data: toggles } = useQuery(customizeSettingsTogglesQueryOptions);
  const disabled = toggles !== undefined && !isPluginEnabled(toggles, plugin.id);
  return (
    <header className="flex flex-col gap-4">
      <Link
        to="/customize/plugins"
        className="inline-flex w-fit items-center gap-1.5 rounded-r6 px-2 py-1 -ms-2 text-body text-secondary no-underline hover:bg-fill-ghost-hover hover:text-primary"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Plugins
      </Link>
      <div className="flex items-center gap-3">
        <IconTile icon={Puzzle} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="m-0 truncate text-[20px]/[28px] font-medium text-primary">
            {plugin.name}
          </h2>
          <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-[13px]/[17px] text-t6">
            {plugin.author !== "" && <span>by {plugin.author} ·</span>}
            <PluginVersion version={plugin.version} versionKind={plugin.versionKind} />
            <span>· {plural(plugin.skills.length, "skill")}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {disabled && <ScopeBadge>Disabled</ScopeBadge>}
          <PluginRowActions
            pluginId={plugin.id}
            name={plugin.name}
            installPath={plugin.installPath}
            triggerLabel={`More options for ${plugin.name}`}
          />
        </div>
      </div>
      <nav aria-label="Plugin sections" className="flex flex-wrap gap-x-4 border-b border-border">
        {pluginDetailTabs(detail).map((tab) => (
          <Link
            key={tab.id}
            to={TAB_TO[tab.id]}
            params={{ pluginId: plugin.id }}
            activeOptions={{ exact: true }}
            className={TAB_CLASS}
          >
            {tab.label}
            {tab.count !== null && <span className="text-t6"> · {tab.count}</span>}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function AsideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-card border border-border bg-surface-0 p-4">
      <h3 className="m-0 text-caption font-medium text-t6">{title}</h3>
      {children}
    </section>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <h3 className="m-0 text-caption font-medium text-t6">{children}</h3>;
}

/** Overview: description, details and categories beside the "Connectors & tools" aside. */
export function PluginOverview({ detail }: { detail: PluginDetail }) {
  const { plugin } = detail;
  const facts: [string, ReactNode][] = [
    ["Author", plugin.author === "" ? "Unknown" : plugin.author],
    ["Version", <PluginVersion version={plugin.version} versionKind={plugin.versionKind} />],
    ["Marketplace", plugin.marketplace],
  ];
  if (detail.homepage !== undefined) {
    facts.push([
      "Homepage",
      <a
        href={detail.homepage}
        target="_blank"
        rel="noreferrer"
        className="break-all text-accent-100 hover:underline"
      >
        {detail.homepage}
      </a>,
    ]);
  }
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <section className="flex flex-col gap-2">
          <Caption>Description</Caption>
          <p className="m-0 whitespace-pre-wrap text-body text-primary">
            {plugin.description === "" ? "No description." : plugin.description}
          </p>
        </section>
        <section className="flex flex-col gap-2">
          <Caption>Details</Caption>
          <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-body">
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-secondary">{label}</dt>
                <dd className="m-0 min-w-0 text-primary">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        {detail.categories.length > 0 && (
          <section className="flex flex-col gap-2">
            <Caption>Categories</Caption>
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {detail.categories.map((category) => (
                <li key={category}>
                  <ScopeBadge>{category}</ScopeBadge>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-3 md:w-60">
        <AsideCard title="Connectors & tools">
          {detail.connectors.length === 0 ? (
            <p className="m-0 text-body text-secondary">No connectors</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {detail.connectors.map((server) => (
                <li key={server.id} className="truncate text-body text-primary">
                  {server.name}
                  <span className="text-t6"> · {transportLabel(server.transport)}</span>
                </li>
              ))}
            </ul>
          )}
        </AsideCard>
      </aside>
    </div>
  );
}

function TabIntro({ children }: { children: ReactNode }) {
  return <p className="m-0 text-body text-secondary">{children}</p>;
}

function RowList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

/** Skills tab: one "/plugin:skill" row per skill, opening the skill detail. */
export function PluginSkills({ plugin }: { plugin: PluginInfoData }) {
  const navigate = useNavigate();
  const namespace = pluginNamespace(plugin.id);
  return (
    <div className="flex flex-col gap-3">
      <TabIntro>
        Invoke by typing / in a session, or let Claude use them automatically for relevant tasks.
      </TabIntro>
      <RowList>
        {plugin.skills.map((skill) => (
          <ListRow
            key={skill.dirname}
            icon={Scroll}
            title={`/${namespace}:${skill.name}`}
            subtitle={skill.description}
            onView={() =>
              void navigate({
                to: "/customize/skills/id/$skillId",
                params: { skillId: `plugin:${plugin.id}:${skill.name}` },
              })
            }
          />
        ))}
      </RowList>
    </div>
  );
}

/** Connectors tab: the servers the plugin's .mcp.json declares. */
export function PluginConnectors({ detail }: { detail: PluginDetail }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-3">
      <TabIntro>Tools and data sources this plugin connects to.</TabIntro>
      <RowList>
        {detail.connectors.map((server) => (
          <ListRow
            key={server.id}
            icon={Plug}
            title={server.name}
            source={transportLabel(server.transport)}
            subtitle={server.urlOrCommand}
            meta={server.enabled ? "Enabled" : "Disabled"}
            onView={() =>
              void navigate({
                to: "/customize/connectors/id/$serverId",
                params: { serverId: toConnectorSlug(server.id) },
              })
            }
          />
        ))}
      </RowList>
    </div>
  );
}

/** Agents or Commands tab: one row per markdown file, opening it in Contents. */
export function PluginFiles({
  plugin,
  kind,
}: {
  plugin: PluginInfoData;
  kind: "agents" | "commands";
}) {
  const navigate = useNavigate();
  const namespace = pluginNamespace(plugin.id);
  const files = kind === "agents" ? plugin.agents : plugin.commands;
  return (
    <div className="flex flex-col gap-3">
      <TabIntro>
        {kind === "agents"
          ? "Subagents Claude can delegate to."
          : "Slash commands this plugin adds."}
      </TabIntro>
      <RowList>
        {files.map((file) => (
          <ListRow
            key={file.filename}
            icon={kind === "agents" ? Bot : SquareSlash}
            title={
              kind === "agents" ? file.name : `/${namespace}:${file.filename.replace(/\.md$/, "")}`
            }
            subtitle={file.description}
            onView={() =>
              void navigate({
                to: "/customize/plugins/id/$pluginId/contents",
                params: { pluginId: plugin.id },
                search: { file: `${kind}/${file.filename}` },
              })
            }
          />
        ))}
      </RowList>
    </div>
  );
}

/** Hooks tab: read-only hooks.json rows (event, matcher, handlers). */
export function PluginHooks({ hooks }: { hooks: readonly PluginHookRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      <TabIntro>Commands this plugin runs on Claude Code events, from hooks/hooks.json.</TabIntro>
      <ul className="m-0 flex list-none flex-col p-0">
        {hooks.map((hook, index) => (
          <li
            key={`${hook.event}:${hook.matcher}:${index}`}
            data-testid="plugin-hook-row"
            className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0"
          >
            <div className="flex items-center gap-2">
              <span className="text-body font-medium text-primary">{hook.event}</span>
              <ScopeBadge>{hook.matcher === "" ? "Any" : hook.matcher}</ScopeBadge>
            </div>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {hook.handlers.map((handler, handlerIndex) => (
                <li key={handlerIndex} className="break-all font-mono text-caption text-secondary">
                  {handler}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
