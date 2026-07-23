import { Link } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { toSubagentSessionId, type ActiveSubagent } from "../lib/subagents";

function ActiveSubagentContent({ agent }: { agent: ActiveSubagent }) {
  return (
    <>
      <Bot className="h-3.5 w-3.5 shrink-0 text-success-000" />
      <span className="shrink-0 rounded bg-bg-200 px-1.5 py-0.5 text-[10px] font-medium text-text-300">
        {agent.agentType || "agent"}
      </span>
      <span className="min-w-0 truncate text-text-100">
        {agent.description || agent.agentId || "Active subagent"}
      </span>
    </>
  );
}

export function ActiveSubagents({ agents }: { agents: ActiveSubagent[] }) {
  if (agents.length === 0) return null;

  return (
    <section
      aria-label="Active subagents"
      className="mt-2 rounded-md border border-success-000/20 bg-success-900/35 px-2.5 py-2"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-success-000">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success-000" />
        Active subagents ({agents.length})
      </div>
      <ul className="mt-1.5 space-y-1">
        {agents.map((agent) => (
          <li key={agent.key}>
            {agent.agentId ? (
              <Link
                to="/session/$id"
                params={{ id: toSubagentSessionId(agent.agentId) }}
                className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-xs no-underline hover:bg-success-900/60"
              >
                <ActiveSubagentContent agent={agent} />
              </Link>
            ) : (
              <div className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-xs">
                <ActiveSubagentContent agent={agent} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
