import { Check, ExternalLink } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import type { ClaudeAiConnectorSummary, McpScope, McpServerSummary } from "../../lib/api/customize";
import { ConnectorTile, connectorDomain } from "./connector-tile";

const CLAUDE_AI_CONNECTORS_URL = "https://claude.ai/customize/connectors/yours";

export const SCOPE_LABEL = {
  user: "User",
  local: "Local",
  project: "Project",
  plugin: "Plugin",
} as const satisfies Record<McpScope, string>;

/** Upstream Type column: "Local" for stdio servers, "Web" for http/sse. */
export function transportLabel(transport: string): "Local" | "Web" {
  return transport === "stdio" ? "Local" : "Web";
}

const TH_CLASS = "h-8 truncate px-3 text-left text-footnote font-medium text-secondary";
const TD_CLASS =
  "box-content h-7 border-b border-border bg-clip-padding px-3 py-2 group-first/row:border-t group-hover/row:border-transparent group-hover/row:bg-fill-ghost-hover group-hover/row:first:rounded-l-r6 group-hover/row:last:rounded-r-r6";

export function ScopeBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-fill-ghost-hover px-2 text-caption font-medium text-secondary">
      {children}
    </span>
  );
}

interface RowProps {
  label: string;
  onView?: () => void;
  children: ReactNode;
}

function Row({ label, onView, children }: RowProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (onView !== undefined && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onView();
    }
  };
  return (
    <tr
      tabIndex={0}
      aria-label={label}
      onClick={onView}
      onKeyDown={onKeyDown}
      className="group/row relative cursor-pointer outline-none focus-visible:shadow-[0_0_0_2px_var(--color-accent-100)]"
    >
      {children}
    </tr>
  );
}

function NameCell({ name, domain }: { name: string; domain: string | null }) {
  return (
    <td className={TD_CLASS}>
      <div className="flex min-w-0 items-center gap-2">
        <ConnectorTile name={name} domain={domain} />
        <span className="truncate text-body font-medium text-primary">{name}</span>
      </div>
    </td>
  );
}

function TypeCell({ type, badge }: { type: string; badge: string }) {
  return (
    <td className={`${TD_CLASS} text-secondary max-sm:hidden`}>
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        <span>{type}</span> <ScopeBadge>{badge}</ScopeBadge>
      </div>
    </td>
  );
}

interface ConnectorsTableProps {
  servers: readonly McpServerSummary[];
  claudeAi: readonly ClaudeAiConnectorSummary[];
  onView: (server: McpServerSummary) => void;
}

/**
 * Upstream cds Table: Connector | Type | Status. Local MCP servers open their
 * detail page; claude.ai connectors are managed in the cloud, so their rows
 * only link out.
 */
export function ConnectorsTable({ servers, claudeAi, onView }: ConnectorsTableProps) {
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-body whitespace-nowrap text-primary sm:min-w-xl">
      <thead>
        <tr>
          <th scope="col" className={TH_CLASS}>
            Connector
          </th>
          <th scope="col" className={`${TH_CLASS} w-40 max-sm:hidden`}>
            Type
          </th>
          <th scope="col" className={`${TH_CLASS} w-40`}>
            Status
          </th>
        </tr>
      </thead>
      <tbody>
        {servers.map((server) => (
          <Row key={server.id} label={`View ${server.name}`} onView={() => onView(server)}>
            <NameCell
              name={server.name}
              domain={connectorDomain(server.transport, server.urlOrCommand)}
            />
            <TypeCell type={transportLabel(server.transport)} badge={SCOPE_LABEL[server.scope]} />
            <td className={`${TD_CLASS} text-secondary`}>
              {server.enabled ? (
                <span className="flex items-center text-primary">
                  <Check aria-hidden="true" className="size-4" />
                  <span className="sr-only">Enabled</span>
                </span>
              ) : (
                <span className="text-t6">Disabled</span>
              )}
            </td>
          </Row>
        ))}
        {claudeAi.map((connector) => (
          <Row key={connector.key} label={`View ${connector.name} on claude.ai`}>
            <NameCell name={connector.name} domain={null} />
            <TypeCell type="Web" badge="claude.ai" />
            <td className={`${TD_CLASS} text-secondary`}>
              <a
                href={CLAUDE_AI_CONNECTORS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-secondary no-underline hover:text-primary"
              >
                Manage on claude.ai
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            </td>
          </Row>
        ))}
      </tbody>
    </table>
  );
}
