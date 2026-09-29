/**
 * Pure, client-safe helpers that map MCP tool names (`mcp__<server>__<tool>`)
 * onto `settings.json` permission rules. Claude Code evaluates deny, then ask,
 * then allow, and a rule matches a tool when it names the whole server
 * (`mcp__srv`, `mcp__srv__*`) or the exact tool (`mcp__srv__tool`).
 */

export interface PermissionRules {
  allow?: string[] | undefined;
  ask?: string[] | undefined;
  deny?: string[] | undefined;
}

export type PermissionBehavior = "allow" | "ask" | "deny";

/** The three upstream segmented choices: Always allow / Needs approval / Blocked. */
export type ToolPermissionChoice = "allow" | "ask" | "blocked";

export interface ResolvedToolPermission {
  behavior: PermissionBehavior | null;
  rule: string | null;
}

const MCP_PREFIX = "mcp__";
const BEHAVIORS_BY_PRECEDENCE = ["deny", "ask", "allow"] as const;
const CLAUDE_AI_PREFIX = "claude_ai_";

/** The CLI replaces every character outside [A-Za-z0-9_-] with `_` when building tool names. */
function normalizeMcpName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * The `<server>` segment of this server's tool names. Plugin servers are
 * namespaced `plugin_<plugin name>_<server name>`; the plugin name is the part
 * of the plugin id before `@<marketplace>`.
 */
export function mcpServerKey(server: { id: string; name: string; scope: string }): string {
  if (server.scope === "plugin") {
    const pluginId = server.id.slice("plugin:".length, server.id.length - server.name.length - 1);
    const pluginName = pluginId.split("@")[0] ?? pluginId;
    return normalizeMcpName(`plugin_${pluginName}_${server.name}`);
  }
  return normalizeMcpName(server.name);
}

export function parseMcpToolName(fullName: string): { serverKey: string; tool: string } | null {
  if (!fullName.startsWith(MCP_PREFIX)) return null;
  const rest = fullName.slice(MCP_PREFIX.length);
  const separator = rest.indexOf("__");
  if (separator <= 0 || separator + 2 >= rest.length) return null;
  return { serverKey: rest.slice(0, separator), tool: rest.slice(separator + 2) };
}

/** Distinct, sorted tool names for one server; wildcard and server-wide rules are skipped. */
export function mcpToolsForServer(names: Iterable<string>, serverKey: string): string[] {
  const prefix = `${MCP_PREFIX}${serverKey}__`;
  const tools = new Set<string>();
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const tool = name.slice(prefix.length);
    if (tool !== "" && tool !== "*") tools.add(tool);
  }
  return [...tools].sort((a, b) => a.localeCompare(b));
}

function serverWideRules(serverKey: string): string[] {
  return [`${MCP_PREFIX}${serverKey}`, `${MCP_PREFIX}${serverKey}__*`];
}

function toolRule(serverKey: string, tool: string): string {
  return `${MCP_PREFIX}${serverKey}__${tool}`;
}

function ruleMatchesTool(rule: string, serverKey: string, tool: string): boolean {
  return rule === toolRule(serverKey, tool) || serverWideRules(serverKey).includes(rule);
}

export function resolveToolPermission(
  rules: PermissionRules,
  serverKey: string,
  tool: string,
): ResolvedToolPermission {
  for (const behavior of BEHAVIORS_BY_PRECEDENCE) {
    const rule = rules[behavior]?.find((candidate) => ruleMatchesTool(candidate, serverKey, tool));
    if (rule !== undefined) return { behavior, rule };
  }
  return { behavior: null, rule: null };
}

/** Always allow = an allow rule; Needs approval = an ask rule or no rule; Blocked = a deny rule. */
export function toolPermissionChoice(behavior: PermissionBehavior | null): ToolPermissionChoice {
  if (behavior === "allow") return "allow";
  if (behavior === "deny") return "blocked";
  return "ask";
}

/** The group's blanket value: the members' shared choice, or "custom" when they differ. */
export function blanketChoice(
  choices: readonly ToolPermissionChoice[],
): ToolPermissionChoice | "custom" {
  const [first] = choices;
  if (first === undefined) return "ask";
  return choices.every((choice) => choice === first) ? first : "custom";
}

const READ_VERBS = new Set([
  "browse",
  "check",
  "count",
  "describe",
  "fetch",
  "find",
  "get",
  "inspect",
  "list",
  "lookup",
  "query",
  "read",
  "search",
  "show",
  "view",
]);

const WRITE_VERBS = new Set([
  "add",
  "apply",
  "archive",
  "click",
  "create",
  "delete",
  "drop",
  "edit",
  "fill",
  "insert",
  "merge",
  "move",
  "post",
  "publish",
  "push",
  "put",
  "remove",
  "reply",
  "run",
  "send",
  "set",
  "trash",
  "update",
  "upload",
  "write",
]);

function toolNameWords(tool: string): string[] {
  return tool
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

/** Heuristic split into upstream's "Read-only tools" and "Write/delete tools" groups. */
export function isReadOnlyToolName(tool: string): boolean {
  const words = toolNameWords(tool);
  return words.some((word) => READ_VERBS.has(word)) && !words.some((word) => WRITE_VERBS.has(word));
}

function choiceSatisfied(choice: ToolPermissionChoice, behavior: PermissionBehavior | null) {
  return toolPermissionChoice(behavior) === choice;
}

function behaviorForChoice(choice: ToolPermissionChoice): PermissionBehavior {
  return choice === "blocked" ? "deny" : choice;
}

function copyRules(rules: PermissionRules): Required<{ [K in PermissionBehavior]: string[] }> {
  return {
    allow: [...new Set(rules.allow ?? [])],
    ask: [...new Set(rules.ask ?? [])],
    deny: [...new Set(rules.deny ?? [])],
  };
}

function addRule(list: string[], rule: string): void {
  if (!list.includes(rule)) list.push(rule);
}

/**
 * Rules that give `tool` the chosen state while leaving the server's other
 * known tools where they were. Tool-specific rules are replaced; a server-wide
 * rule that would still win (a deny over a new allow, say) is expanded into
 * per-tool rules for the other known tools first.
 */
export function setToolPermission(
  rules: PermissionRules,
  serverKey: string,
  knownTools: readonly string[],
  tool: string,
  choice: ToolPermissionChoice,
): Required<{ [K in PermissionBehavior]: string[] }> {
  const specific = toolRule(serverKey, tool);
  const next = copyRules(rules);
  for (const behavior of BEHAVIORS_BY_PRECEDENCE) {
    next[behavior] = next[behavior].filter((rule) => rule !== specific);
  }
  if (choiceSatisfied(choice, resolveToolPermission(next, serverKey, tool).behavior)) return next;

  addRule(next[behaviorForChoice(choice)], specific);
  if (choiceSatisfied(choice, resolveToolPermission(next, serverKey, tool).behavior)) return next;

  const wide = serverWideRules(serverKey);
  const others = knownTools.filter((other) => other !== tool);
  const previous = others.map((other) => resolveToolPermission(rules, serverKey, other).behavior);
  for (const behavior of BEHAVIORS_BY_PRECEDENCE) {
    next[behavior] = next[behavior].filter((rule) => !wide.includes(rule));
  }
  others.forEach((other, index) => {
    const behavior = previous[index];
    if (behavior !== null && behavior !== undefined) {
      addRule(next[behavior], toolRule(serverKey, other));
    }
  });
  return next;
}

export interface ClaudeAiConnector {
  key: string;
  name: string;
  tools: string[];
}

/** claude.ai connectors (`mcp__claude_ai_<Name>__…`), managed in the cloud and listed read-only. */
export function claudeAiConnectors(names: Iterable<string>): ClaudeAiConnector[] {
  const list = [...names];
  const keys = new Set<string>();
  for (const name of list) {
    const parsed = parseMcpToolName(name);
    if (parsed?.serverKey.startsWith(CLAUDE_AI_PREFIX)) keys.add(parsed.serverKey);
  }
  return [...keys]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      key,
      name: key.slice(CLAUDE_AI_PREFIX.length).replace(/_/g, " "),
      tools: mcpToolsForServer(list, key),
    }));
}

/**
 * Connector ids hold paths (`local:/Users/me/app:server`); the detail URL
 * carries them base64url-encoded because dev servers 404 dotted segments.
 */
export function toConnectorSlug(id: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(id)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromConnectorSlug(slug: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(slug)) return null;
  try {
    const binary = atob(slug.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * settings.json with its allow/ask/deny lists replaced by `rules`. Other keys
 * (including the rest of `permissions`) are kept; a list that was absent and
 * is still empty stays absent.
 */
export function mergePermissionRules(
  settings: Record<string, unknown>,
  rules: Required<{ [K in PermissionBehavior]: string[] }>,
): Record<string, unknown> {
  const permissions = isRecord(settings["permissions"]) ? { ...settings["permissions"] } : {};
  for (const behavior of ["allow", "ask", "deny"] as const) {
    if (rules[behavior].length > 0 || behavior in permissions) {
      permissions[behavior] = rules[behavior];
    }
  }
  return { ...settings, permissions };
}
