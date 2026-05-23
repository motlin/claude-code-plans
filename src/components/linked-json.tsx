import { Bot, ExternalLink, FileText, Hash } from "lucide-react";
import type { ReactNode } from "react";

export interface LinkedJsonContext {
  sessionId: string;
  projectId?: string | undefined;
  knownUuids?: Set<string> | undefined;
}

interface LinkedJsonProps {
  value: unknown;
  context: LinkedJsonContext;
}

/**
 * Recursive JSON renderer that syntax-colors tokens and turns recognized
 * string values into navigable links. Keys stay inert; only values link.
 */
export function LinkedJson({ value, context }: LinkedJsonProps) {
  return (
    <pre className="bg-bg-100 text-text-000 text-xs font-mono whitespace-pre-wrap break-all rounded p-3 overflow-x-auto leading-relaxed">
      <JsonValue value={value} path={[]} ctx={context} indent={0} />
    </pre>
  );
}

const INDENT_SIZE = 2;

function indentStr(level: number): string {
  return " ".repeat(level * INDENT_SIZE);
}

function JsonValue({
  value,
  path,
  ctx,
  indent,
}: {
  value: unknown;
  path: string[];
  ctx: LinkedJsonContext;
  indent: number;
}) {
  if (value === null) return <span className="text-text-500 italic">null</span>;
  if (value === undefined) return <span className="text-text-500 italic">undefined</span>;

  switch (typeof value) {
    case "string":
      return <StringValue value={value} path={path} ctx={ctx} />;
    case "number":
      return <span className="text-[#b5cea8]">{String(value)}</span>;
    case "boolean":
      return <span className="text-[#569cd6]">{String(value)}</span>;
    case "object":
      if (Array.isArray(value)) {
        return <JsonArray items={value} path={path} ctx={ctx} indent={indent} />;
      }
      return (
        <JsonObject obj={value as Record<string, unknown>} path={path} ctx={ctx} indent={indent} />
      );
    default:
      return <span className="text-text-300">{JSON.stringify(value)}</span>;
  }
}

function JsonArray({
  items,
  path,
  ctx,
  indent,
}: {
  items: unknown[];
  path: string[];
  ctx: LinkedJsonContext;
  indent: number;
}) {
  if (items.length === 0) return <span className="text-text-300">[]</span>;

  return (
    <>
      <span className="text-text-300">{"["}</span>
      {"\n"}
      {items.map((item, i) => (
        <span key={i}>
          {indentStr(indent + 1)}
          <JsonValue value={item} path={[...path, String(i)]} ctx={ctx} indent={indent + 1} />
          {i < items.length - 1 ? <span className="text-text-300">,</span> : null}
          {"\n"}
        </span>
      ))}
      {indentStr(indent)}
      <span className="text-text-300">{"]"}</span>
    </>
  );
}

function JsonObject({
  obj,
  path,
  ctx,
  indent,
}: {
  obj: Record<string, unknown>;
  path: string[];
  ctx: LinkedJsonContext;
  indent: number;
}) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return <span className="text-text-300">{"{}"}</span>;

  return (
    <>
      <span className="text-text-300">{"{"}</span>
      {"\n"}
      {keys.map((key, i) => (
        <span key={key}>
          {indentStr(indent + 1)}
          <span className="text-[#9cdcfe]">"{key}"</span>
          <span className="text-text-300">: </span>
          <JsonValue value={obj[key]} path={[...path, key]} ctx={ctx} indent={indent + 1} />
          {i < keys.length - 1 ? <span className="text-text-300">,</span> : null}
          {"\n"}
        </span>
      ))}
      {indentStr(indent)}
      <span className="text-text-300">{"}"}</span>
    </>
  );
}

// --- Link resolution ---

interface ResolvedLink {
  href: string;
  title: string;
  icon: ReactNode;
  isExternal?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_ID_RE = /^(agent-|a[0-9a-f-]+)/i;
const URL_RE = /^https?:\/\/.+/;
const PLAN_MD_RE = /^plans\/(.+\.md)$/;
const MEMORY_MD_RE = /^memories\/(.+\.md)$/;

const ICON_SIZE = "h-3 w-3 inline-block ml-0.5 align-text-bottom";

function resolveLink(value: string, key: string, ctx: LinkedJsonContext): ResolvedLink | null {
  if (key === "agentId" || key === "agent_id") {
    const agentSessionId = value.startsWith("agent-") ? value : `agent-${value}`;
    return {
      href: `/session/${agentSessionId}`,
      title: `Subagent session: ${agentSessionId}`,
      icon: <Bot className={ICON_SIZE} />,
    };
  }

  if (key === "sessionId" || key === "session_id") {
    if (UUID_RE.test(value)) {
      return {
        href: `/session/${value}`,
        title: `Session: ${value}`,
        icon: <Hash className={ICON_SIZE} />,
      };
    }
  }

  if (key === "tool_use_id" || key === "uuid" || key === "parentUuid" || key === "sourceUuid") {
    if (UUID_RE.test(value)) {
      const isKnown = ctx.knownUuids?.has(value) ?? true;
      if (isKnown) {
        return {
          href: `/session/${ctx.sessionId}/source/${value}`,
          title: `Source JSONL: ${value.slice(0, 8)}...`,
          icon: <FileText className={ICON_SIZE} />,
        };
      }
    }
  }

  if (key === "gitBranch" || key === "git_branch") {
    if (ctx.projectId) {
      return {
        href: `/project/${ctx.projectId}/sessions?branch=${encodeURIComponent(value)}`,
        title: `Branch: ${value}`,
        icon: <Hash className={ICON_SIZE} />,
      };
    }
  }

  if (URL_RE.test(value)) {
    return {
      href: value,
      title: value,
      icon: <ExternalLink className={ICON_SIZE} />,
      isExternal: true,
    };
  }

  const planMatch = PLAN_MD_RE.exec(value);
  if (planMatch?.[1]) {
    const filename = planMatch[1];
    return {
      href: `/plan/${encodeURIComponent(filename)}`,
      title: `Plan: ${filename}`,
      icon: <FileText className={ICON_SIZE} />,
    };
  }

  const memoryMatch = MEMORY_MD_RE.exec(value);
  if (memoryMatch?.[1]) {
    const filename = memoryMatch[1];
    return {
      href: `/memory/${encodeURIComponent(filename)}`,
      title: `Memory: ${filename}`,
      icon: <FileText className={ICON_SIZE} />,
    };
  }

  if (
    AGENT_ID_RE.test(value) &&
    (key === "id" || key === "parent_agent_id" || key === "parentAgentId")
  ) {
    const agentSessionId = value.startsWith("agent-") ? value : `agent-${value}`;
    return {
      href: `/session/${agentSessionId}`,
      title: `Subagent session: ${agentSessionId}`,
      icon: <Bot className={ICON_SIZE} />,
    };
  }

  return null;
}

function StringValue({
  value,
  path,
  ctx,
}: {
  value: string;
  path: string[];
  ctx: LinkedJsonContext;
}) {
  const key = path[path.length - 1] ?? "";
  const resolved = resolveLink(value, key, ctx);

  const truncateDisplay = value.length > 500;
  const displayValue = truncateDisplay ? value.slice(0, 500) + "..." : value;
  const escaped = displayValue
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");

  if (!resolved) {
    return <span className="text-[#ce9178]">"{escaped}"</span>;
  }

  if (resolved.isExternal) {
    return (
      <span className="text-[#ce9178]">
        "
        <a
          href={resolved.href}
          target="_blank"
          rel="noopener noreferrer"
          title={resolved.title}
          className="text-accent-100 hover:text-accent-000 underline decoration-dotted hover:decoration-solid"
        >
          {escaped}
          {resolved.icon}
        </a>
        "
      </span>
    );
  }

  return (
    <span className="text-[#ce9178]">
      "
      <a
        href={resolved.href}
        title={resolved.title}
        className="text-accent-100 hover:text-accent-000 underline decoration-dotted hover:decoration-solid"
      >
        {escaped}
        {resolved.icon}
      </a>
      "
    </span>
  );
}
