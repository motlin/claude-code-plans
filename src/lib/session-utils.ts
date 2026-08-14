/**
 * Minimal shape needed by summarizeToolCalls, categorize, and diffStatsForCall.
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

const ARG_BLOCK_RE = /<(description|instructions|arguments|args|user-request)>([\s\S]*?)<\/\1>/;
const ARG_TAG_RE = /<\/?(?:description|instructions|arguments|args|user-request)>/g;

/**
 * Reduce an expanded slash-command prompt to the user's own words. Command
 * bodies wrap `$ARGUMENTS` in a block such as `<description>`, so that block is
 * the intent and everything around it is template boilerplate. When the user
 * passed no arguments the block is empty and the command's own opening line is
 * the best summary available.
 *
 * Only ever applied to `isMeta` prompts. A command body is injected by the CLI
 * rather than typed, and it carries no markers of its own — the `<command-name>`
 * header lands in a separate record — so `isMeta` is the only signal that these
 * tags are template scaffolding and not something the user pasted.
 */
function stripCommandBoilerplate(text: string): string {
  const match = text.match(ARG_BLOCK_RE);
  if (match) {
    const args = match[2]!.trim();
    if (args) return args;

    const openingLine = text.slice(0, match.index!).trim().split("\n")[0];
    if (openingLine) return openingLine;
  }
  return text.replace(ARG_TAG_RE, "");
}

export function extractSessionTitle(
  text: string,
  fallback?: string,
  options?: { isMeta?: boolean },
): string {
  const command = cleanCommandText(text);
  const boilerplateFree = options?.isMeta === true ? stripCommandBoilerplate(command) : command;
  const cleaned = boilerplateFree.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback ?? "Untitled Session";

  if (cleaned.length <= 80) return cleaned;

  const truncated = cleaned.slice(0, 80);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 40) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}

type ToolCategory =
  | "edit"
  | "write"
  | "grep"
  | "read"
  | "glob"
  | "webfetch"
  | "websearch"
  | "agent"
  | "bash"
  | "recall"
  | "memwrite"
  | "toolsearch"
  | "skill"
  | "task"
  | "todo"
  | "planenter"
  | "planexit"
  | "cron";

/**
 * Categories whose calls change a file, each with the verb upstream Normal uses
 * for it: a `Write` creates a file ("Created cache.ts") while `Edit` and
 * `MultiEdit` change one that exists ("Edited cache.ts").
 */
const MUTATION_VERBS = { edit: "Edited", write: "Created" } as const;

type MutationCategory = keyof typeof MUTATION_VERBS;

function isMutation(cat: ToolCategory): cat is MutationCategory {
  return cat === "edit" || cat === "write";
}

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

function diffStatsForCall(call: ToolCallLike): {
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
    return isMemoryPath(filePath) ? "memwrite" : "write";
  }
  if (call.name === "Edit" || call.name === "MultiEdit") return "edit";
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
 *   <span class="text-body text-secondary">{verb}</span>
 *   <span class="text-secondary"> {rest}</span>
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

function filePathOf(call: ToolCallLike | undefined): string | null {
  if (!call) return null;
  const filePath = call.input["file_path"];
  if (typeof filePath !== "string" || filePath === "") return null;
  return filePath;
}

function singleFileBasename(call: ToolCallLike | undefined): string | null {
  const filePath = filePathOf(call);
  return filePath === null ? null : basenameFromPath(filePath);
}

function appendDiffStats(rest: string, stats: { added: number; removed: number }): string {
  const { added, removed } = stats;
  if (added > 0 && removed > 0) return `${rest} +${added} -${removed}`;
  if (added > 0) return `${rest} +${added}`;
  if (removed > 0) return `${rest} -${removed}`;
  return rest;
}

/**
 * The one file-changing category eligible for coalescing: exactly one call, and
 * the other mutation category absent, so the compound verb names it without
 * dropping a segment.
 */
function soleMutationCategory(counts: Map<ToolCategory, number>): MutationCategory | null {
  const present = (Object.keys(MUTATION_VERBS) as MutationCategory[]).filter((cat) =>
    counts.has(cat),
  );
  const only = present[0];
  if (present.length !== 1 || counts.get(only!) !== 1) return null;
  return only!;
}

/**
 * Upstream Normal collapses a read and a change of the SAME file into a single
 * segment whose verb names both actions in the order they happened -- "Read and
 * edited cache.ts", "Read and created index.ts", "Edited and read cache.ts" --
 * rather than two segments.
 */
function coalescedReadMutation(
  counts: Map<ToolCategory, number>,
  firstCall: Map<ToolCategory, ToolCallLike>,
): { verb: string; emitter: ToolCategory; basename: string; mutation: MutationCategory } | null {
  if (counts.get("read") !== 1) return null;
  const mutation = soleMutationCategory(counts);
  if (mutation === null) return null;
  const readPath = filePathOf(firstCall.get("read"));
  if (readPath === null || readPath !== filePathOf(firstCall.get(mutation))) return null;
  const basename = basenameFromPath(readPath);
  const mutationVerb = MUTATION_VERBS[mutation];
  for (const cat of counts.keys()) {
    if (cat === "read") {
      return {
        verb: `Read and ${mutationVerb.toLowerCase()}`,
        emitter: "read",
        basename,
        mutation,
      };
    }
    if (cat === mutation) {
      return { verb: `${mutationVerb} and read`, emitter: mutation, basename, mutation };
    }
  }
  return null;
}

function buildSummarySegments(calls: ToolCallLike[]): SummarySegment[] {
  // Insertion order carries the summary order: upstream Normal writes both
  // "Updated todos, read 3 files" and "Read index.ts, updated todos", so
  // segments follow the order each tool was first called.
  const counts = new Map<ToolCategory, number>();
  const firstCall = new Map<ToolCategory, ToolCallLike>();
  const diffStats = new Map<MutationCategory, { added: number; removed: number }>();
  const unknownTools = new Map<string, number>();

  const statsFor = (cat: MutationCategory) => diffStats.get(cat) ?? { added: 0, removed: 0 };

  for (const call of calls) {
    const cat = categorize(call);
    if (cat === null) {
      const displayName = formatToolName(call.name);
      unknownTools.set(displayName, (unknownTools.get(displayName) ?? 0) + 1);
    } else {
      const prev = counts.get(cat) ?? 0;
      counts.set(cat, prev + 1);
      if (prev === 0) firstCall.set(cat, call);
      if (isMutation(cat)) {
        const s = diffStatsForCall(call);
        const total = statsFor(cat);
        diffStats.set(cat, { added: total.added + s.added, removed: total.removed + s.removed });
      }
    }
  }

  // A read and a change of the same file collapse into one compound segment,
  // emitted in place of whichever of the two categories came first.
  const compound = coalescedReadMutation(counts, firstCall);

  const segments: SummarySegment[] = [];
  for (const [cat, count] of counts) {
    if (compound !== null && (cat === "read" || cat === compound.mutation)) {
      if (cat === compound.emitter) {
        segments.push({
          verb: compound.verb,
          rest: appendDiffStats(compound.basename, statsFor(compound.mutation)),
        });
      }
      continue;
    }
    switch (cat) {
      case "edit":
      case "write": {
        const singleFilename = count === 1 ? singleFileBasename(firstCall.get(cat)) : null;
        const rest = appendDiffStats(
          singleFilename ?? pluralize(count, "a file", "{n} files"),
          statsFor(cat),
        );
        segments.push({ verb: MUTATION_VERBS[cat], rest });
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

  // Upstream capitalizes only the leading verb: "Ran 2 commands, read cache.ts".
  return segments.map((segment, i) =>
    i === 0 ? segment : { verb: segment.verb.toLowerCase(), rest: segment.rest },
  );
}

export function summarizeToolCallsStructured(calls: ToolCallLike[]): SummarySegment[] {
  if (calls.length === 0) return [];
  return buildSummarySegments(calls);
}

export function summarizeToolCalls(calls: ToolCallLike[]): string {
  const segments = buildSummarySegments(calls);
  return segments.map((s) => `${s.verb.toLowerCase()} ${s.rest}`).join(", ");
}
