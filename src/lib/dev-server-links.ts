import { z } from "zod";

/**
 * Loopback dev servers a session started or talked to, offered as "Open dev
 * server" links: the local stand-in for claude.ai/code's Preview pane, which
 * needs Claude Desktop's built-in browser. Links open in a new tab; nothing is
 * iframed.
 */

/** How many of the session's most recent Bash results are scanned for URLs. */
export const DEV_SERVER_BASH_RESULT_LIMIT = 20;

export interface DevServer {
  /** Origin only, e.g. `http://localhost:5173`. */
  url: string;
  /** The `.claude/launch.json` configuration name, when it came from there. */
  name?: string;
}

// oxlint-disable-next-line no-control-regex -- stripping terminal escapes is the point
const ANSI_ESCAPE = /\u001B\[[0-9;?]*[A-Za-z]/g;
const LOOPBACK_URL = /\bhttps?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]):\d+(?!\w)/gi;
const IPV4_LOOPBACK = /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "[::1]" || host === "::1" || IPV4_LOOPBACK.test(host);
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

/** Parse a candidate into its loopback origin, or undefined when it is not one. */
export function loopbackOrigin(candidate: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  if (!isLoopbackHost(parsed.hostname)) return undefined;
  // URL drops a scheme's default port, so an explicit :80 on http reads as "".
  if (parsed.port === "" || !isValidPort(Number(parsed.port))) return undefined;
  return parsed.origin;
}

/** Loopback origins with an explicit port, deduped, in first-seen order. */
export function extractDevServerUrls(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const text of texts) {
    for (const match of text.replace(ANSI_ESCAPE, "").matchAll(LOOPBACK_URL)) {
      const port = Number(match[0].slice(match[0].lastIndexOf(":") + 1));
      if (!isValidPort(port)) continue;
      const origin = loopbackOrigin(match[0]);
      if (origin !== undefined) seen.add(origin);
    }
  }
  return [...seen];
}

const ToolUseBlock = z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string() });
const TextBlock = z.object({ type: z.literal("text"), text: z.string() });
const ToolResultBlock = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(z.unknown())]).optional(),
});
const MessageRecord = z.object({
  message: z.object({ content: z.union([z.string(), z.array(z.unknown())]) }),
});

function contentBlocks(record: unknown): unknown[] {
  const parsed = MessageRecord.safeParse(record);
  if (!parsed.success || typeof parsed.data.message.content === "string") return [];
  return parsed.data.message.content;
}

function resultText(content: string | unknown[] | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content
    .flatMap((block) => {
      const text = TextBlock.safeParse(block);
      return text.success ? [text.data.text] : [];
    })
    .join("\n");
}

/** Text of the session's latest Bash tool results, newest first. */
export function latestBashResultTexts(
  records: readonly unknown[],
  limit = DEV_SERVER_BASH_RESULT_LIMIT,
): string[] {
  const bashIds = new Set<string>();
  const texts: string[] = [];
  for (const record of records) {
    for (const block of contentBlocks(record)) {
      const use = ToolUseBlock.safeParse(block);
      if (use.success) {
        if (use.data.name === "Bash") bashIds.add(use.data.id);
        continue;
      }
      const result = ToolResultBlock.safeParse(block);
      if (result.success && bashIds.has(result.data.tool_use_id)) {
        texts.push(resultText(result.data.content));
      }
    }
  }
  return texts.slice(-limit).reverse();
}

const LaunchJson = z.object({
  configurations: z.array(z.object({ name: z.string().optional(), port: z.number().optional() })),
});

/** Servers declared in a project's `.claude/launch.json` that name a valid port. */
export function launchJsonDevServers(json: unknown): DevServer[] {
  const parsed = LaunchJson.safeParse(json);
  if (!parsed.success) return [];
  return parsed.data.configurations.flatMap((configuration) => {
    if (configuration.port === undefined || !isValidPort(configuration.port)) return [];
    const url = `http://localhost:${configuration.port}`;
    return [configuration.name === undefined ? { url } : { url, name: configuration.name }];
  });
}

/** Declared servers first, then detected URLs not already declared. */
export function mergeDevServers(declared: readonly DevServer[], detected: readonly string[]) {
  const seen = new Set<string>();
  const merged: DevServer[] = [];
  for (const server of [...declared, ...detected.map((url) => ({ url }))]) {
    if (seen.has(server.url)) continue;
    seen.add(server.url);
    merged.push(server);
  }
  return merged;
}
