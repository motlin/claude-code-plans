import { useState } from "react";
import { CheckCircle, Circle, ChevronDown, ChevronRight } from "lucide-react";
import type { ClientToolCall } from "./tool-renderers/types";

interface TaskItem {
  id: string;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
}

interface AgentItem {
  id: number;
  description: string;
  agentType: string;
  status: "running" | "completed" | "error";
  result?: string;
}

const AGENT_TYPE_COLORS: Record<string, string> = {
  Explore: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  Plan: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "claude-code-guide": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  "general-purpose": "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const DEFAULT_AGENT_COLOR =
  "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300";

function getAgentColor(agentType: string): string {
  return AGENT_TYPE_COLORS[agentType] ?? DEFAULT_AGENT_COLOR;
}

export function extractTasks(toolCalls: ClientToolCall[]): TaskItem[] {
  const tasks = new Map<string, TaskItem>();
  let autoId = 0;

  for (const call of toolCalls) {
    if (call.name === "TaskCreate") {
      autoId++;
      const id = String(autoId);
      tasks.set(id, {
        id,
        subject: (call.input["subject"] as string) ?? `Task ${id}`,
        description: (call.input["description"] as string) ?? "",
        status: "pending",
      });
    } else if (call.name === "TaskUpdate") {
      const taskId = call.input["taskId"] as string | undefined;
      if (taskId && tasks.has(taskId)) {
        const existing = tasks.get(taskId)!;
        const newStatus = call.input["status"] as string | undefined;
        if (newStatus === "pending" || newStatus === "in_progress" || newStatus === "completed") {
          existing.status = newStatus;
        }
      }
    }
  }

  return Array.from(tasks.values());
}

function extractAgents(toolCalls: ClientToolCall[]): AgentItem[] {
  const agents: AgentItem[] = [];
  let autoId = 0;

  for (const call of toolCalls) {
    if (call.name === "Agent") {
      autoId++;
      const prompt = (call.input["prompt"] as string) ?? "";
      const desc = (call.input["description"] as string) ?? prompt.slice(0, 80);
      const agentType = (call.input["subagent_type"] as string) ?? "general-purpose";
      const hasResult = call.result !== undefined;
      const isError = call.isError === true;

      const agent: AgentItem = {
        id: autoId,
        description: desc,
        agentType,
        status: isError ? "error" : hasResult ? "completed" : "running",
      };
      if (call.result !== undefined) agent.result = call.result;
      agents.push(agent);
    }
  }

  return agents;
}

const statusBadgeClasses: Record<TaskItem["status"], string> = {
  pending: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  in_progress: "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
  completed: "bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400",
};

const statusLabel: Record<TaskItem["status"], string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
};

function AgentCard({ agent }: { agent: AgentItem }) {
  const [expanded, setExpanded] = useState(false);
  const color = getAgentColor(agent.agentType);
  const statusText =
    agent.status === "error" ? "Error" : agent.status === "completed" ? "Done" : "Running";
  const statusColor =
    agent.status === "error"
      ? "text-danger-000"
      : agent.status === "completed"
        ? "text-success-000"
        : "text-accent-000";

  return (
    <div className="border border-border-300/15 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => agent.result && setExpanded(!expanded)}
        className={`w-full px-3 py-2 flex items-center gap-2 text-left ${agent.result ? "cursor-pointer hover:bg-bg-200/30" : ""}`}
      >
        {agent.result &&
          (expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-text-500" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-text-500" />
          ))}
        <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${color}`}>
          {agent.agentType}
        </span>
        <span className="text-sm text-text-000 truncate flex-1">{agent.description}</span>
        <span className={`text-xs shrink-0 ${statusColor}`}>{statusText}</span>
      </button>
      {expanded && agent.result && (
        <div className="px-3 pb-2 border-t border-border-300/15">
          <pre className="mt-2 text-xs text-text-500 whitespace-pre-wrap max-h-48 overflow-auto leading-relaxed">
            {agent.result.length > 500 ? agent.result.slice(0, 500) + "..." : agent.result}
          </pre>
        </div>
      )}
    </div>
  );
}

export function TasksView({ toolCalls }: { toolCalls: ClientToolCall[] }) {
  const tasks = extractTasks(toolCalls);
  const agents = extractAgents(toolCalls);

  if (tasks.length === 0 && agents.length === 0) return null;

  const completed = tasks.filter((t) => t.status === "completed").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const pending = tasks.filter((t) => t.status === "pending").length;

  const agentTypeCounts: Record<string, number> = {};
  for (const agent of agents) {
    agentTypeCounts[agent.agentType] = (agentTypeCounts[agent.agentType] ?? 0) + 1;
  }

  return (
    <div>
      {tasks.length > 0 && (
        <>
          <div className="flex items-center gap-4 mb-3 text-sm">
            <span className="text-text-000">
              <span className="font-medium">{tasks.length}</span> tasks
            </span>
            {completed > 0 && (
              <span className="text-green-600 flex items-center gap-1">
                <CheckCircle className="h-3 w-3" /> {completed} completed
              </span>
            )}
            {inProgress > 0 && (
              <span className="text-blue-600 flex items-center gap-1">
                <Circle className="h-3 w-3" /> {inProgress} in progress
              </span>
            )}
            {pending > 0 && (
              <span className="text-text-500 flex items-center gap-1">
                <Circle className="h-3 w-3" /> {pending} pending
              </span>
            )}
          </div>

          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="border border-border-300/15 rounded-lg overflow-hidden">
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-500 font-mono">#{task.id}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClasses[task.status]}`}
                    >
                      {statusLabel[task.status]}
                    </span>
                  </div>
                  <h3 className="text-sm font-medium text-text-000 mt-1 truncate">
                    {task.subject}
                  </h3>
                  {task.description && (
                    <p className="text-xs text-text-500 mt-0.5 line-clamp-2">{task.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {agents.length > 0 && (
        <div className={tasks.length > 0 ? "mt-4" : ""}>
          <div className="flex items-center gap-3 mb-3 text-sm flex-wrap">
            <span className="text-text-000 font-medium">{agents.length} agents</span>
            {Object.entries(agentTypeCounts).map(([type, count]) => (
              <span
                key={type}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${getAgentColor(type)}`}
              >
                {type} ({count})
              </span>
            ))}
          </div>

          <div className="space-y-2">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
