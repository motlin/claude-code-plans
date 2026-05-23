import { lazy, type ComponentType } from "react";
import type { ToolRendererProps } from "./types";
import { getMcpRenderer } from "./mcp-registry";

const EditRenderer = lazy(() =>
  import("./edit-renderer").then((m) => ({ default: m.EditRenderer })),
);
const BashRenderer = lazy(() =>
  import("./bash-renderer").then((m) => ({ default: m.BashRenderer })),
);
const ReadRenderer = lazy(() =>
  import("./read-renderer").then((m) => ({ default: m.ReadRenderer })),
);
const WriteRenderer = lazy(() =>
  import("./write-renderer").then((m) => ({ default: m.WriteRenderer })),
);
const GlobRenderer = lazy(() =>
  import("./glob-renderer").then((m) => ({ default: m.GlobRenderer })),
);
const GrepRenderer = lazy(() =>
  import("./grep-renderer").then((m) => ({ default: m.GrepRenderer })),
);
const AskUserQuestionRenderer = lazy(() =>
  import("./ask-user-question-renderer").then((m) => ({
    default: m.AskUserQuestionRenderer,
  })),
);
const AgentRenderer = lazy(() =>
  import("./agent-renderer").then((m) => ({ default: m.AgentRenderer })),
);
const TaskCreateRenderer = lazy(() =>
  import("./task-create-renderer").then((m) => ({
    default: m.TaskCreateRenderer,
  })),
);
const TaskUpdateRenderer = lazy(() =>
  import("./task-update-renderer").then((m) => ({
    default: m.TaskUpdateRenderer,
  })),
);
const TaskGetRenderer = lazy(() =>
  import("./task-get-renderer").then((m) => ({ default: m.TaskGetRenderer })),
);
const TaskListRenderer = lazy(() =>
  import("./task-list-renderer").then((m) => ({ default: m.TaskListRenderer })),
);
const ExitPlanModeRenderer = lazy(() =>
  import("./exit-plan-mode-renderer").then((m) => ({
    default: m.ExitPlanModeRenderer,
  })),
);
const EnterPlanModeRenderer = lazy(() =>
  import("./enter-plan-mode-renderer").then((m) => ({
    default: m.EnterPlanModeRenderer,
  })),
);
const TodoWriteRenderer = lazy(() =>
  import("./todo-write-renderer").then((m) => ({
    default: m.TodoWriteRenderer,
  })),
);
const WebSearchRenderer = lazy(() =>
  import("./web-search-renderer").then((m) => ({
    default: m.WebSearchRenderer,
  })),
);
const SendMessageRenderer = lazy(() =>
  import("./send-message-renderer").then((m) => ({
    default: m.SendMessageRenderer,
  })),
);
const TaskStopRenderer = lazy(() =>
  import("./task-stop-renderer").then((m) => ({ default: m.TaskStopRenderer })),
);
const CronCreateRenderer = lazy(() =>
  import("./cron-create-renderer").then((m) => ({
    default: m.CronCreateRenderer,
  })),
);
const SkillRenderer = lazy(() =>
  import("./skill-renderer").then((m) => ({ default: m.SkillRenderer })),
);
const WebFetchRenderer = lazy(() =>
  import("./webfetch-renderer").then((m) => ({ default: m.WebFetchRenderer })),
);
const ToolSearchRenderer = lazy(() =>
  import("./tool-search-renderer").then((m) => ({
    default: m.ToolSearchRenderer,
  })),
);
const FallbackRenderer = lazy(() =>
  import("./fallback-renderer").then((m) => ({ default: m.FallbackRenderer })),
);

const registry: Record<string, ComponentType<ToolRendererProps>> = {
  Edit: EditRenderer,
  MultiEdit: EditRenderer,
  Bash: BashRenderer,
  Read: ReadRenderer,
  Write: WriteRenderer,
  Glob: GlobRenderer,
  Grep: GrepRenderer,
  AskUserQuestion: AskUserQuestionRenderer,
  Agent: AgentRenderer,
  TaskCreate: TaskCreateRenderer,
  TaskUpdate: TaskUpdateRenderer,
  TaskGet: TaskGetRenderer,
  TaskList: TaskListRenderer,
  ExitPlanMode: ExitPlanModeRenderer,
  EnterPlanMode: EnterPlanModeRenderer,
  TodoWrite: TodoWriteRenderer,
  WebSearch: WebSearchRenderer,
  SendMessage: SendMessageRenderer,
  TaskStop: TaskStopRenderer,
  CronCreate: CronCreateRenderer,
  Skill: SkillRenderer,
  WebFetch: WebFetchRenderer,
  ToolSearch: ToolSearchRenderer,
  __fallback__: FallbackRenderer,
};

export function getToolRenderer(name: string): ComponentType<ToolRendererProps> {
  if (name.startsWith("mcp__")) {
    const server = name.slice(5).split("__")[0];
    if (server) return getMcpRenderer(server);
    return registry["__fallback__"]!;
  }
  return registry[name] ?? registry["__fallback__"]!;
}

export type { ClientToolCall } from "./types";
