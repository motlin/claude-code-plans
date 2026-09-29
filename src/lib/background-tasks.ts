import type { HookBackgroundTaskPayload } from "./hook-events";
import { isRunningBackgroundTask } from "./session-state";
import type { ActiveSubagent } from "./subagents";

export type BackgroundTaskKind = "bash" | "agent" | "monitor" | "task";
export type BackgroundTaskStatus = "running" | "completed" | "failed" | "stopped";

/** One row of the Background tasks pane. */
export interface BackgroundTask {
  /** The harness task id when known, otherwise the launching tool_use id. */
  id: string;
  toolUseId: string | null;
  kind: BackgroundTaskKind;
  description: string;
  command: string | null;
  status: BackgroundTaskStatus;
  /** TaskOutput/BashOutput output, Monitor events, or an agent's result. */
  output: string | null;
  /** The latest task-notification summary line. */
  summary: string | null;
}

export interface BackgroundTaskGroups {
  running: BackgroundTask[];
  finished: BackgroundTask[];
}

/** Live state the transcript window cannot show. */
export interface BackgroundTaskLiveState {
  /** Without a live session, transcript tasks that never finished are shown stopped. */
  sessionActive: boolean;
  /** The latest Stop hook's `background_tasks`. */
  hookTasks?: readonly HookBackgroundTaskPayload[];
  runningSubagents?: readonly ActiveSubagent[];
}

const KIND_LABELS: Record<BackgroundTaskKind, string> = {
  bash: "Bash",
  agent: "Agent",
  monitor: "Monitor",
  task: "Task",
};

const STATUS_LABELS: Record<BackgroundTaskStatus, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

/** The card's meta line, e.g. "Bash · Completed". */
export function backgroundTaskMeta(task: BackgroundTask): string {
  return `${KIND_LABELS[task.kind]} · ${STATUS_LABELS[task.status]}`;
}

/** Running tasks in the given order; finished ones newest first. */
export function groupBackgroundTasks(tasks: readonly BackgroundTask[]): BackgroundTaskGroups {
  return {
    running: tasks.filter((task) => task.status === "running"),
    finished: tasks.filter((task) => task.status !== "running").reverse(),
  };
}

/**
 * View options facts for the pane: `total` counts what the pane lists (task
 * rows, plus the session's subagents, which the pane links to).
 */
export function backgroundTasksFacts(
  groups: BackgroundTaskGroups,
  subagentCount: number,
): { total: number; running: number } {
  return {
    total: groups.running.length + groups.finished.length + subagentCount,
    running: groups.running.length,
  };
}

function asObject(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => asString(asObject(block)?.["text"]) ?? "")
    .filter((text) => text !== "")
    .join("\n");
}

function tag(text: string, name: string): string | null {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text);
  return match?.[1] === undefined ? null : match[1].trim();
}

function allTags(text: string, name: string): string[] {
  return [...text.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))].map((match) =>
    (match[1] ?? "").trim(),
  );
}

function notificationStatus(status: string | null): BackgroundTaskStatus | null {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "killed":
    case "stopped":
      return "stopped";
    default:
      return null;
  }
}

function hookKind(type: string): BackgroundTaskKind {
  if (type.includes("bash") || type.includes("shell")) return "bash";
  if (type.includes("agent")) return "agent";
  if (type.includes("monitor")) return "monitor";
  return "task";
}

const LAUNCH_ID_PATTERNS = [
  /running in background with ID: (\S+?)\.?(?:\s|$)/,
  /Monitor started \(task (\S+?)[,)]/,
  /agentId:\s*(\S+)/,
];

function launchedTaskId(
  result: Readonly<Record<string, unknown>> | null,
  text: string,
): string | null {
  for (const key of ["backgroundTaskId", "taskId", "agentId"]) {
    const id = asString(result?.[key]);
    if (id !== null) return id;
  }
  for (const pattern of LAUNCH_ID_PATTERNS) {
    const id = pattern.exec(text)?.[1];
    if (id !== undefined) return id;
  }
  return null;
}

interface Tracked {
  task: BackgroundTask;
  /** Order of the last status change, for newest-finished-first. */
  settledAt: number;
}

function unprefixedAgentId(id: string): string {
  return id.startsWith("agent-") ? id.slice("agent-".length) : id;
}

/**
 * Background work in a session: `run_in_background` Bash and Agent calls and
 * Monitor watches, settled by their `<task-notification>` records and filled
 * in by TaskOutput/BashOutput reads, plus running subagents and Stop-hook
 * `background_tasks` the transcript window does not show.
 */
export function extractBackgroundTasks(
  records: readonly Readonly<Record<string, unknown>>[],
  live: BackgroundTaskLiveState,
): BackgroundTaskGroups {
  const tasks: Tracked[] = [];
  const byToolUseId = new Map<string, Tracked>();
  const byTaskId = new Map<string, Tracked>();
  /** Launch calls awaiting the result that says whether (and as what) they backgrounded. */
  const pendingAgents = new Map<string, { description: string }>();
  const readers = new Map<string, string>();
  const stoppers = new Map<string, string>();
  let clock = 0;

  const track = (task: BackgroundTask): Tracked => {
    const tracked = { task, settledAt: 0 };
    tasks.push(tracked);
    if (task.toolUseId !== null) byToolUseId.set(task.toolUseId, tracked);
    return tracked;
  };
  const find = (taskId: string | null, toolUseId: string | null): Tracked | undefined =>
    (toolUseId === null ? undefined : byToolUseId.get(toolUseId)) ??
    (taskId === null ? undefined : byTaskId.get(taskId));
  const settle = (tracked: Tracked, status: BackgroundTaskStatus): void => {
    tracked.task.status = status;
    tracked.settledAt = ++clock;
  };

  for (const record of records) {
    const message = asObject(record["message"]);
    const content = message?.["content"];

    if (record["type"] === "user" && typeof content === "string") {
      if (!content.startsWith("<task-notification>")) continue;
      const toolUseId = tag(content, "tool-use-id");
      const status = notificationStatus(tag(content, "status"));
      const summary = tag(content, "summary");
      for (const taskId of allTags(content, "task-id")) {
        const tracked = find(taskId, toolUseId);
        if (tracked === undefined) continue;
        if (summary !== null) tracked.task.summary = summary;
        const event = tag(content, "event");
        if (event !== null) {
          tracked.task.output =
            tracked.task.output === null ? event : `${tracked.task.output}\n${event}`;
        }
        const result = tag(content, "result");
        if (result !== null) tracked.task.output = result;
        if (status !== null) settle(tracked, status);
      }
      continue;
    }

    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      const block = asObject(raw);
      if (block === null) continue;

      if (block["type"] === "tool_use") {
        const id = asString(block["id"]);
        const name = asString(block["name"]);
        const input = asObject(block["input"]) ?? {};
        if (id === null) continue;
        const background = input["run_in_background"] === true;
        const description = asString(input["description"]);
        const command = asString(input["command"]);
        if (name === "Bash" && background) {
          track({
            id,
            toolUseId: id,
            kind: "bash",
            description: description ?? command ?? "",
            command,
            status: "running",
            output: null,
            summary: null,
          });
        } else if (name === "Monitor") {
          track({
            id,
            toolUseId: id,
            kind: "monitor",
            description: description ?? command ?? "",
            command,
            status: "running",
            output: null,
            summary: null,
          });
        } else if (name === "Agent") {
          pendingAgents.set(id, { description: description ?? "" });
        } else if (name === "TaskOutput" || name === "BashOutput") {
          const taskId = asString(input["task_id"]) ?? asString(input["bash_id"]);
          if (taskId !== null) readers.set(id, taskId);
        } else if (name === "TaskStop" || name === "KillShell") {
          const taskId = asString(input["task_id"]) ?? asString(input["shell_id"]);
          if (taskId !== null) stoppers.set(id, taskId);
        }
        continue;
      }

      if (block["type"] !== "tool_result") continue;
      const toolUseId = asString(block["tool_use_id"]);
      if (toolUseId === null) continue;
      const text = textOf(block["content"]);
      const result = asObject(record["toolUseResult"]);
      const isError = block["is_error"] === true;

      const agent = pendingAgents.get(toolUseId);
      if (agent !== undefined) {
        pendingAgents.delete(toolUseId);
        if (result?.["isAsync"] === true || text.startsWith("Async agent launched")) {
          const taskId = launchedTaskId(result, text);
          const tracked = track({
            id: taskId ?? toolUseId,
            toolUseId,
            kind: "agent",
            description: agent.description,
            command: null,
            status: "running",
            output: null,
            summary: null,
          });
          if (taskId !== null) byTaskId.set(taskId, tracked);
        }
        continue;
      }

      const launched = byToolUseId.get(toolUseId);
      if (launched !== undefined) {
        if (isError) {
          tasks.splice(tasks.indexOf(launched), 1);
          byToolUseId.delete(toolUseId);
          continue;
        }
        const taskId = launchedTaskId(result, text);
        if (taskId !== null) {
          launched.task.id = taskId;
          byTaskId.set(taskId, launched);
        }
        continue;
      }

      const readTaskId = readers.get(toolUseId);
      if (readTaskId !== undefined) {
        const tracked = byTaskId.get(readTaskId);
        const output = tag(text, "output") ?? tag(text, "stdout");
        if (tracked !== undefined && output !== null) tracked.task.output = output;
        continue;
      }

      const stopTaskId = stoppers.get(toolUseId);
      if (stopTaskId !== undefined && !isError) {
        const tracked = byTaskId.get(stopTaskId);
        if (tracked !== undefined && tracked.task.status === "running") settle(tracked, "stopped");
      }
    }
  }

  if (!live.sessionActive) {
    for (const tracked of tasks) {
      if (tracked.task.status === "running") settle(tracked, "stopped");
    }
  }

  const liveTasks: BackgroundTask[] = [];
  for (const subagent of live.runningSubagents ?? []) {
    const agentId = unprefixedAgentId(subagent.agentId);
    if (byToolUseId.has(subagent.key) || (agentId !== "" && byTaskId.has(agentId))) continue;
    liveTasks.push({
      id: agentId === "" ? subagent.key : agentId,
      toolUseId: agentId === "" ? subagent.key : null,
      kind: "agent",
      description: subagent.description,
      command: null,
      status: "running",
      output: null,
      summary: null,
    });
  }
  for (const hookTask of live.hookTasks ?? []) {
    if (!isRunningBackgroundTask(hookTask)) continue;
    const id = unprefixedAgentId(hookTask.id);
    if (byTaskId.has(id) || liveTasks.some((task) => task.id === id)) continue;
    liveTasks.push({
      id,
      toolUseId: null,
      kind: hookKind(hookTask.type),
      description: hookTask.description,
      command: hookTask.command ?? null,
      status: "running",
      output: null,
      summary: null,
    });
  }

  const ordered = [
    ...tasks.filter((tracked) => tracked.task.status === "running").map((t) => t.task),
    ...liveTasks,
    ...tasks
      .filter((tracked) => tracked.task.status !== "running")
      .sort((a, b) => a.settledAt - b.settledAt)
      .map((tracked) => tracked.task),
  ];
  return groupBackgroundTasks(ordered);
}
