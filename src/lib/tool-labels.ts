import { FileEditToolUseResultSchema, GitOperationSchema, type GitOperation } from "./schemas";
import { gitBranchActionLabels, gitCommitKindLabels, gitPrActionLabels } from "./schema-choices";

/**
 * What a tool row needs from the call's `toolUseResult`, pulled out through
 * strict schemas when the transcript is read so the label can depend on the
 * outcome (a Write that created vs. updated a file, a Bash that committed).
 */
export interface ToolResultMeta {
  writeType?: "create" | "update";
  gitOperation?: GitOperation;
}

export interface ToolLabelCall {
  name: string;
  input: Record<string, unknown>;
  resultMeta?: ToolResultMeta | undefined;
}

/**
 * Upstream claude.ai/code's label for a tool row: the verb, an optional meta
 * beside it, and the verb a failed call swaps in. `doneLabel` is a whole
 * phrase that names a successful row on its own (a Bash call's past-tensed
 * description, a subagent's description) in place of verb + meta.
 */
export interface ToolLabel {
  verb: string;
  meta?: string;
  metaIsCode?: true;
  metaHref?: string;
  doneLabel?: string;
  failedVerb: string;
}

export function toolResultMetaFrom(toolUseResult: unknown): ToolResultMeta | undefined {
  if (typeof toolUseResult !== "object" || toolUseResult === null) return undefined;
  if ("gitOperation" in toolUseResult) {
    const git = GitOperationSchema.safeParse(toolUseResult.gitOperation);
    return git.success ? { gitOperation: git.data } : undefined;
  }
  if ("type" in toolUseResult) {
    const file = FileEditToolUseResultSchema.safeParse(toolUseResult);
    if (file.success && "type" in file.data) return { writeType: file.data.type };
  }
  return undefined;
}

/** Past-tense forms for verbs that don't take an -ed/-d suffix. */
const IRREGULAR_PAST_TENSE: Record<string, string> = {
  build: "built",
  cut: "cut",
  find: "found",
  get: "got",
  keep: "kept",
  leave: "left",
  make: "made",
  put: "put",
  read: "read",
  rerun: "reran",
  run: "ran",
  see: "saw",
  send: "sent",
  set: "set",
  show: "showed",
  split: "split",
  take: "took",
  tell: "told",
  write: "wrote",
};

function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowercaseFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Past-tense a description's leading verb, the way upstream labels a Bash row:
 * "Check git status" -> "Checked git status", "See what's new" -> "Saw what's
 * new". Text that doesn't start with a word, or that is already past tense, is
 * left verbatim.
 */
function pastTense(description: string): string {
  const match = /^([A-Za-z]+)([\s\S]*)$/.exec(description);
  if (!match) return description;
  const word = match[1]!;
  const rest = match[2]!;
  const lower = word.toLowerCase();
  const irregular = IRREGULAR_PAST_TENSE[lower];
  if (irregular) return capitalizeFirst(irregular) + rest;
  if (lower.endsWith("ed")) return capitalizeFirst(lower) + rest;
  if (lower.endsWith("e")) return capitalizeFirst(`${lower}d`) + rest;
  if (/[^aeiou]y$/.test(lower)) return capitalizeFirst(`${lower.slice(0, -1)}ied`) + rest;
  return capitalizeFirst(`${lower}ed`) + rest;
}

/**
 * Tools whose label is a fixed phrase: upstream's per-tool table plus its
 * generic map. The failed form is "Failed to <verb in present tense>".
 */
const FIXED_LABELS: Record<string, { verb: string; failedVerb: string }> = {
  Read: { verb: "Read", failedVerb: "Failed to read" },
  Edit: { verb: "Edited", failedVerb: "Failed to edit" },
  MultiEdit: { verb: "Edited", failedVerb: "Failed to edit" },
  NotebookEdit: { verb: "Edited", failedVerb: "Failed to edit" },
  Grep: { verb: "Searched", failedVerb: "Failed to search" },
  Glob: { verb: "Searched", failedVerb: "Failed to search" },
  LS: { verb: "Listed", failedVerb: "Failed to list" },
  WebFetch: { verb: "Fetched", failedVerb: "Failed to fetch" },
  WebSearch: { verb: "Searched web", failedVerb: "Failed to search web" },
  TaskGet: { verb: "Read task", failedVerb: "Failed to read task" },
  TaskList: { verb: "Listed tasks", failedVerb: "Failed to list tasks" },
  TaskCreate: { verb: "Added task", failedVerb: "Failed to add task" },
  TaskStop: { verb: "Stopped task", failedVerb: "Failed to stop task" },
  EnterPlanMode: { verb: "Started planning", failedVerb: "Failed to start planning" },
  ExitPlanMode: { verb: "Proposed plan", failedVerb: "Failed to propose plan" },
  // Not in upstream's table (claude.ai/code has no deferred tools); kept local.
  ToolSearch: { verb: "Searched tools", failedVerb: "Failed to search tools" },
  CronCreate: { verb: "Scheduled", failedVerb: "Failed to schedule" },
  ReportFindings: {
    verb: "Reported review findings",
    failedVerb: "Failed to report review findings",
  },
  TaskOutput: { verb: "Read task output", failedVerb: "Failed to read task output" },
  Monitor: {
    verb: "Started watching background command",
    failedVerb: "Failed to start watching background command",
  },
  CronList: { verb: "Listed scheduled prompts", failedVerb: "Failed to list scheduled prompts" },
  CronDelete: { verb: "Stopped scheduled prompt", failedVerb: "Failed to stop scheduled prompt" },
  LSP: { verb: "Inspected code", failedVerb: "Failed to inspect code" },
  ListMcpResourcesTool: { verb: "Listed resources", failedVerb: "Failed to list resources" },
  ReadMcpResourceTool: { verb: "Read resource", failedVerb: "Failed to read resource" },
  ReadMcpResourceDirTool: {
    verb: "Listed resource folder",
    failedVerb: "Failed to list resource folder",
  },
  WaitForMcpServers: { verb: "Loaded connectors", failedVerb: "Failed to load connectors" },
  RefreshMcpTools: { verb: "Refreshed tools", failedVerb: "Failed to refresh tools" },
  Workflow: { verb: "Ran workflow", failedVerb: "Failed to run workflow" },
  SendFeedback: { verb: "Sent feedback", failedVerb: "Failed to send feedback" },
};

const TASK_STATUS_VERBS: Record<string, string> = {
  completed: "Completed task",
  in_progress: "Started task",
  pending: "Reset task to pending",
  deleted: "Removed task",
};

function stringInput(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function taskUpdateVerb(input: Record<string, unknown>): string {
  const status = stringInput(input, "status");
  if (status !== null) return TASK_STATUS_VERBS[status] ?? "Updated task status";
  const changed = Object.keys(input).filter((key) => key !== "taskId" && key !== "task_id");
  if (changed.length === 1 && changed[0] === "subject") return "Renamed task";
  return "Updated task";
}

function askedMeta(input: Record<string, unknown>): string | null {
  const questions = input["questions"];
  if (!Array.isArray(questions) || questions.length === 0) return null;
  if (questions.length > 1) return `${questions.length} questions`;
  const first: unknown = questions[0];
  if (typeof first !== "object" || first === null || !("header" in first)) return null;
  return typeof first.header === "string" && first.header !== "" ? first.header : null;
}

function gitLabel(git: GitOperation): Omit<ToolLabel, "failedVerb"> | null {
  if (git.pr) {
    const label = { verb: gitPrActionLabels[git.pr.action], meta: `#${git.pr.number}` };
    return git.pr.url === undefined ? label : { ...label, metaHref: git.pr.url };
  }
  if (git.commit)
    return { verb: gitCommitKindLabels[git.commit.kind], meta: git.commit.sha.slice(0, 7) };
  if (git.push) return { verb: "Pushed", meta: git.push.branch };
  if (git.branch) return { verb: gitBranchActionLabels[git.branch.action], meta: git.branch.ref };
  return null;
}

function bashLabel(call: ToolLabelCall): ToolLabel {
  const failedVerb = "Failed to run";
  const git = call.resultMeta?.gitOperation;
  const gitVerb = git === undefined ? null : gitLabel(git);
  if (gitVerb !== null) return { ...gitVerb, failedVerb };
  const description = stringInput(call.input, "description");
  const command = stringInput(call.input, "command");
  if (description !== null) {
    return { verb: "Ran", meta: description, doneLabel: pastTense(description), failedVerb };
  }
  if (command !== null) return { verb: "Ran", meta: command, doneLabel: command, failedVerb };
  return { verb: "Ran", meta: "a command", failedVerb };
}

/**
 * "Server: tool name" for `mcp__server__tool`, dropping a `plugin_<pkg>_`
 * prefix from the server and spacing the tool's underscores.
 */
function mcpToolLabel(name: string): string {
  const [server = "", ...toolParts] = name.slice("mcp__".length).split("__");
  const serverName = server.startsWith("plugin_") ? server.split("_").pop()! : server;
  const tool = toolParts.join("__").replaceAll("_", " ");
  return `${capitalizeFirst(serverName)}: ${tool}`;
}

export function toolLabel(call: ToolLabelCall): ToolLabel {
  const { name, input } = call;
  const fixed = FIXED_LABELS[name];
  if (fixed) return { ...fixed };

  switch (name) {
    case "Bash":
    case "PowerShell":
      return bashLabel(call);
    case "Write":
      return {
        verb: call.resultMeta?.writeType === "update" ? "Updated" : "Created",
        failedVerb: "Failed to write",
      };
    case "Agent":
    case "Task": {
      const description = stringInput(input, "description");
      const failedVerb = "Failed to run agent";
      if (description === null) return { verb: "Ran agent", failedVerb };
      return { verb: "Ran agent", meta: description, doneLabel: description, failedVerb };
    }
    case "Skill": {
      const skill = stringInput(input, "skill");
      const failedVerb = "Failed to run skill";
      if (skill === null) return { verb: "Ran skill", failedVerb };
      return { verb: "Ran skill", meta: `/${skill}`, metaIsCode: true, failedVerb };
    }
    case "TaskUpdate":
      return { verb: taskUpdateVerb(input), failedVerb: "Failed to update task" };
    case "TodoWrite": {
      const todos = input["todos"];
      const cleared = Array.isArray(todos) && todos.length === 0;
      return {
        verb: cleared ? "Cleared todos" : "Updated todos",
        failedVerb: "Failed to update todos",
      };
    }
    case "AskUserQuestion": {
      const meta = askedMeta(input);
      const failedVerb = "Failed to ask";
      return meta === null ? { verb: "Asked", failedVerb } : { verb: "Asked", meta, failedVerb };
    }
  }

  const label = name.startsWith("mcp__") ? mcpToolLabel(name) : name;
  return { verb: `Used ${label}`, failedVerb: `Failed to use ${label}` };
}

/**
 * A failed row whose param is its own description reads as one phrase
 * ("Failed to install dependencies"), as upstream's `jo()` failed label does.
 */
export function failedDescriptionLabel(description: string): string {
  return `Failed to ${lowercaseFirst(description)}`;
}
