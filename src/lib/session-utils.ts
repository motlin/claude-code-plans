/**
 * Minimal shape needed by summarizeToolCalls, categorize, and diffStatsForEditCall.
 * Satisfied by raw content blocks, readSession tool call objects, and test data alike.
 */
export interface ToolCallLike {
  name: string;
  input: Record<string, unknown>;
}

const COMMAND_MESSAGE_RE = /<command-message[^>]*>([\s\S]*?)<\/command-message>/;
const STRIP_BLOCK_RE =
  /<(?:command-name|command-args|local-command-stdout)[^>]*>[\s\S]*?<\/(?:command-name|command-args|local-command-stdout)>/g;
const STRIP_TAG_RE =
  /<\/?(?:command-message|command-name|command-args|command|local-command-caveat|local-command-stdout)[^>]*>/g;

function cleanCommandText(text: string): string {
  const msgMatch = text.match(COMMAND_MESSAGE_RE);
  if (msgMatch) {
    return msgMatch[1]!.replace(STRIP_TAG_RE, "").trim();
  }
  return text.replace(STRIP_BLOCK_RE, "").replace(STRIP_TAG_RE, "").trim();
}

export function stripCommandTags(text: string): string {
  return cleanCommandText(text);
}

const BASH_INPUT_RE = /^\s*<bash-input>([\s\S]*?)<\/bash-input>\s*$/;
const BASH_OUTPUT_RE =
  /^\s*<bash-stdout>([\s\S]*?)<\/bash-stdout>\s*<bash-stderr>([\s\S]*?)<\/bash-stderr>\s*$/;

export function parseBashInput(text: string): { command: string } | null {
  const m = text.match(BASH_INPUT_RE);
  if (!m) return null;
  return { command: m[1]! };
}

export function parseBashOutput(text: string): { stdout: string; stderr: string } | null {
  const m = text.match(BASH_OUTPUT_RE);
  if (!m) return null;
  return { stdout: m[1]!, stderr: m[2]! };
}

export function parseCommandBlock(text: string): { name: string; args?: string } | null {
  const nameMatch = text.match(/<command-name>(.*?)<\/command-name>/);
  if (!nameMatch) return null;
  const argsMatch = text.match(/<command-args>(.*?)<\/command-args>/s);
  const args = argsMatch?.[1]?.trim();
  const result: { name: string; args?: string } = { name: nameMatch[1]! };
  if (args) result.args = args;
  return result;
}

export function extractSessionTitle(text: string, fallback?: string): string {
  const cleaned = cleanCommandText(text);
  if (!cleaned) return fallback ?? "Untitled Session";

  if (cleaned.length <= 80) return cleaned;

  const truncated = cleaned.slice(0, 80);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 40) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}

const TOOL_CATEGORIES = [
  "edit",
  "grep",
  "read",
  "glob",
  "webfetch",
  "websearch",
  "agent",
  "bash",
  "recall",
  "memwrite",
  "toolsearch",
  "skill",
  "task",
  "todo",
  "planenter",
  "planexit",
  "cron",
] as const;
type ToolCategory = (typeof TOOL_CATEGORIES)[number];

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);

function isMemoryPath(filePath: string): boolean {
  if (!filePath.endsWith(".md")) return false;
  if (!filePath.includes("/.claude/")) return false;
  return /\/\.claude\/(?:memory\/|projects\/[^/]+\/memory\/)/.test(filePath);
}

function countDiffLines(oldStr: string, newStr: string): { added: number; removed: number } {
  if (oldStr === newStr) return { added: 0, removed: 0 };
  const oldLines = oldStr === "" ? [] : oldStr.split("\n");
  const newLines = newStr === "" ? [] : newStr.split("\n");
  const oldCounts = new Map<string, number>();
  for (const line of oldLines) oldCounts.set(line, (oldCounts.get(line) ?? 0) + 1);
  const newCounts = new Map<string, number>();
  for (const line of newLines) newCounts.set(line, (newCounts.get(line) ?? 0) + 1);

  let added = 0;
  for (const [line, count] of newCounts) {
    const inOld = oldCounts.get(line) ?? 0;
    if (count > inOld) added += count - inOld;
  }
  let removed = 0;
  for (const [line, count] of oldCounts) {
    const inNew = newCounts.get(line) ?? 0;
    if (count > inNew) removed += count - inNew;
  }
  return { added, removed };
}

/** One old/new string pair applied by an `Edit` or `MultiEdit` tool call. */
export interface EditDiffEntry {
  oldStr: string;
  newStr: string;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The replacements a file-editing tool call performs, in order. `Edit` carries a
 * single pair at the top level; `MultiEdit` carries an `edits[]` array and falls
 * back to the top-level pair when that array is absent or empty.
 */
export function editDiffEntries(input: Record<string, unknown>): EditDiffEntry[] {
  const edits = input["edits"];
  if (Array.isArray(edits)) {
    const entries = edits
      .filter((edit): edit is Record<string, unknown> => typeof edit === "object" && edit !== null)
      .map((edit) => ({
        oldStr: asString(edit["old_string"]),
        newStr: asString(edit["new_string"]),
      }));
    if (entries.length > 0) return entries;
  }
  if (typeof input["old_string"] !== "string") return [];
  return [{ oldStr: asString(input["old_string"]), newStr: asString(input["new_string"]) }];
}

function diffStatsForEditCall(call: ToolCallLike): {
  added: number;
  removed: number;
} {
  const input = call.input;
  if (call.name === "Write") {
    const content = asString(input["content"]);
    const added = content === "" ? 0 : content.split("\n").length;
    return { added, removed: 0 };
  }
  if (call.name === "Edit" || call.name === "MultiEdit") {
    let added = 0;
    let removed = 0;
    for (const entry of editDiffEntries(input)) {
      const stats = countDiffLines(entry.oldStr, entry.newStr);
      added += stats.added;
      removed += stats.removed;
    }
    return { added, removed };
  }
  return { added: 0, removed: 0 };
}

function categorize(call: ToolCallLike): ToolCategory | null {
  const filePath =
    typeof call.input["file_path"] === "string" ? (call.input["file_path"] as string) : "";
  if (call.name === "Read") {
    return isMemoryPath(filePath) ? "recall" : "read";
  }
  if (call.name === "Write") {
    return isMemoryPath(filePath) ? "memwrite" : "edit";
  }
  if (EDIT_TOOLS.has(call.name)) return "edit";
  if (call.name === "Bash") return "bash";
  if (call.name === "Grep") return "grep";
  if (call.name === "Glob") return "glob";
  if (call.name === "Agent") return "agent";
  if (call.name === "WebFetch") return "webfetch";
  if (call.name === "WebSearch") return "websearch";
  if (call.name === "ToolSearch") return "toolsearch";
  if (call.name === "Skill") return "skill";
  if (
    call.name === "TaskCreate" ||
    call.name === "TaskUpdate" ||
    call.name === "TaskGet" ||
    call.name === "TaskList" ||
    call.name === "TaskStop"
  )
    return "task";
  if (call.name === "TodoWrite") return "todo";
  if (call.name === "EnterPlanMode") return "planenter";
  if (call.name === "ExitPlanMode") return "planexit";
  if (call.name === "CronCreate") return "cron";
  return null;
}

export function formatToolName(toolName: string): string {
  if (toolName.startsWith("mcp__")) {
    const withoutPrefix = toolName.slice("mcp__".length);
    const serverName = withoutPrefix.split("__")[0]!;
    if (serverName.startsWith("plugin_")) {
      const segments = serverName.split("_");
      return segments[segments.length - 1]!;
    }
    return serverName;
  }
  return toolName;
}

function pluralize(count: number, singular: string, plural: string): string {
  if (count === 1) return singular;
  return plural.replace("{n}", String(count));
}

/**
 * Extract text from a tool_result content field.
 * Content can be a plain string or an array of {type: 'text', text: string} blocks.
 */
export function extractToolResultContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const item of content) {
      if (typeof item === "object" && item !== null && "type" in item && "text" in item) {
        const block = item as { type: string; text: string };
        if (block.type === "text" && typeof block.text === "string") {
          texts.push(block.text);
        }
      }
    }
    return texts.length > 0 ? texts.join("\n") : undefined;
  }
  return undefined;
}

/**
 * Strip non-rendering wrapper tags from tool result text.
 */
export function stripResultTags(text: string): string {
  let result = text;
  result = result.replace(/<\/?tool_use_error>/g, "");
  result = result.replace(/<\/?persisted-output>/g, "");
  result = result.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  if (result !== text) result = result.trim();
  return result;
}

/**
 * Truncate text to a maximum number of lines, appending a count of omitted lines.
 */
export function truncateResult(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  const truncated = lines.slice(0, maxLines);
  truncated.push(`... (${lines.length - maxLines} more lines)`);
  return truncated.join("\n");
}

/**
 * Structured summary segment: a verb and its rest text, for span-based rendering.
 * Upstream claude.ai/code renders each segment as:
 *   <span class="text-body text-assistant-secondary">{verb}</span>
 *   <span class="text-assistant-secondary"> {rest}</span>
 */
export interface SummarySegment {
  verb: string;
  rest: string;
}

function basenameFromPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) return path;
  return path.slice(lastSlash + 1);
}

function singleFileBasename(call: ToolCallLike | undefined): string | null {
  if (!call) return null;
  const filePath = call.input["file_path"];
  if (typeof filePath !== "string" || filePath === "") return null;
  return basenameFromPath(filePath);
}

function buildSummarySegments(calls: ToolCallLike[]): SummarySegment[] {
  const counts = new Map<ToolCategory, number>();
  const firstCall = new Map<ToolCategory, ToolCallLike>();
  const editStats = { added: 0, removed: 0 };
  const unknownTools = new Map<string, number>();

  for (const call of calls) {
    const cat = categorize(call);
    if (cat === null) {
      const displayName = formatToolName(call.name);
      unknownTools.set(displayName, (unknownTools.get(displayName) ?? 0) + 1);
    } else {
      const prev = counts.get(cat) ?? 0;
      counts.set(cat, prev + 1);
      if (prev === 0) firstCall.set(cat, call);
      if (cat === "edit") {
        const s = diffStatsForEditCall(call);
        editStats.added += s.added;
        editStats.removed += s.removed;
      }
    }
  }

  const segments: SummarySegment[] = [];
  for (const cat of TOOL_CATEGORIES) {
    const count = counts.get(cat) ?? 0;
    if (count === 0) continue;
    switch (cat) {
      case "edit": {
        const singleFilename = count === 1 ? singleFileBasename(firstCall.get(cat)) : null;
        let rest = singleFilename ?? pluralize(count, "a file", "{n} files");
        const { added, removed } = editStats;
        if (added > 0 && removed > 0) rest += ` +${added} -${removed}`;
        else if (added > 0) rest += ` +${added}`;
        else if (removed > 0) rest += ` -${removed}`;
        segments.push({ verb: "Edited", rest });
        break;
      }
      case "grep":
        segments.push({
          verb: "Searched",
          rest: pluralize(count, "for a pattern", "for {n} patterns"),
        });
        break;
      case "read": {
        const singleFilename = count === 1 ? singleFileBasename(firstCall.get(cat)) : null;
        segments.push({
          verb: "Read",
          rest: singleFilename ?? pluralize(count, "a file", "{n} files"),
        });
        break;
      }
      case "glob":
        segments.push({
          verb: "Found",
          rest: pluralize(count, "files", "files ({n} searches)"),
        });
        break;
      case "webfetch":
        segments.push({
          verb: "Fetched",
          rest: pluralize(count, "a page", "{n} pages"),
        });
        break;
      case "websearch":
        segments.push({
          verb: "Searched",
          rest: pluralize(count, "the web", "the web ({n} searches)"),
        });
        break;
      case "agent":
        segments.push({
          verb: "Ran",
          rest: pluralize(count, "an agent", "{n} agents"),
        });
        break;
      case "bash":
        segments.push({
          verb: "Ran",
          rest: pluralize(count, "a command", "{n} commands"),
        });
        break;
      case "recall":
        segments.push({
          verb: "Recalled",
          rest: pluralize(count, "a memory", "{n} memories"),
        });
        break;
      case "memwrite":
        segments.push({
          verb: "Wrote",
          rest: pluralize(count, "a memory", "{n} memories"),
        });
        break;
      case "toolsearch":
        segments.push({
          verb: "Loaded",
          rest: pluralize(count, "a tool schema", "{n} tool schemas"),
        });
        break;
      case "skill":
        segments.push({
          verb: "Used",
          rest: pluralize(count, "a skill", "{n} skills"),
        });
        break;
      case "task":
        segments.push({
          verb: "Managed",
          rest: pluralize(count, "a task", "{n} tasks"),
        });
        break;
      case "todo":
        segments.push({
          verb: "Updated",
          rest: pluralize(count, "todos", "todos ({n} times)"),
        });
        break;
      case "planenter":
        segments.push({
          verb: "Entered",
          rest: pluralize(count, "plan mode", "plan mode ({n} times)"),
        });
        break;
      case "planexit":
        segments.push({
          verb: "Presented",
          rest: pluralize(count, "a plan", "{n} plans"),
        });
        break;
      case "cron":
        segments.push({
          verb: "Scheduled",
          rest: pluralize(count, "a job", "{n} jobs"),
        });
        break;
    }
  }

  for (const [displayName, count] of unknownTools) {
    if (count === 1) {
      segments.push({ verb: "Called", rest: displayName });
    } else {
      segments.push({ verb: "Called", rest: `${displayName} ${count} times` });
    }
  }

  return segments;
}

export function summarizeToolCallsStructured(calls: ToolCallLike[]): SummarySegment[] {
  if (calls.length === 0) return [];
  return buildSummarySegments(calls);
}

export function summarizeToolCalls(calls: ToolCallLike[]): string {
  const segments = buildSummarySegments(calls);
  return segments.map((s) => `${s.verb.toLowerCase()} ${s.rest}`).join(", ");
}
