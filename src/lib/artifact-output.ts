/**
 * Parses the output of an `Artifact` tool call into the artifact it points at,
 * mirroring claude.ai/code's transcript parser: JSON first, then the
 * "Created/Updated/Opened" prefixes, then the last claude.ai artifact URL in
 * the CLI's "Published <file_path> at <url>" text.
 */

export type ArtifactUrlKind = "uuid" | "slug";

export interface ParsedArtifact {
  url: string;
  kind: ArtifactUrlKind;
  id: string;
  path?: string;
  title?: string;
  version?: string;
  opened?: true;
}

export interface ArtifactUrl {
  url: string;
  kind: ArtifactUrlKind;
  id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARTIFACT_PATH_PATTERN = /^\/(?:code\/)?artifact\/([A-Za-z0-9-]+)\/?$/;
const ARTIFACT_HOSTS = new Set(["claude.ai", "www.claude.ai"]);
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

const PREFIXES: ReadonlyArray<{ prefix: string; opened: boolean }> = [
  { prefix: "Created a new Artifact at ", opened: false },
  { prefix: "Updated the Artifact at ", opened: false },
  { prefix: "Opened the Artifact at ", opened: true },
];

const PREFIX_PATH_PATTERN = /^\S+(?: \([^)]*\))? with (.+?) \(and any `files` listed\)/;
const PUBLISHED_PATH_PATTERN = /^Published (.+) at $/;
const VERSION_ID_PATTERN = /\((?:Version \d+, version id|version) ([^)\s,]+)\)/;

/** Validates and normalizes an https claude.ai artifact URL; anything else is undefined. */
export function normalizeArtifactUrl(raw: string): ArtifactUrl | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || !ARTIFACT_HOSTS.has(parsed.hostname) || parsed.port !== "") {
    return undefined;
  }
  const match = ARTIFACT_PATH_PATTERN.exec(parsed.pathname);
  const id = match?.[1];
  if (id === undefined) return undefined;
  const isCodePath = parsed.pathname.startsWith("/code/");
  const kind: ArtifactUrlKind = UUID_PATTERN.test(id) ? "uuid" : "slug";
  const url = `https://claude.ai/${isCodePath ? "code/" : ""}artifact/${id}`;
  return { url, kind, id };
}

function parseJsonOutput(text: string): ParsedArtifact | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record["url"] !== "string") return undefined;
  const artifact = normalizeArtifactUrl(record["url"]);
  if (artifact === undefined) return undefined;
  const result: ParsedArtifact = { ...artifact };
  if (typeof record["path"] === "string") result.path = record["path"];
  if (record["opened"] === true) result.opened = true;
  return result;
}

function parsePrefixedOutput(text: string): ParsedArtifact | null | undefined {
  const entry = PREFIXES.find(({ prefix }) => text.startsWith(prefix));
  if (entry === undefined) return null;
  const rest = text.slice(entry.prefix.length);
  const token = /^\S+/.exec(rest)?.[0];
  if (token === undefined) return undefined;
  const artifact = normalizeArtifactUrl(token.replace(TRAILING_PUNCTUATION, ""));
  if (artifact === undefined) return undefined;
  const result: ParsedArtifact = { ...artifact };
  const path = PREFIX_PATH_PATTERN.exec(rest)?.[1];
  if (path !== undefined) result.path = path;
  if (entry.opened) result.opened = true;
  return result;
}

function parsePublishedOutput(text: string): ParsedArtifact | undefined {
  const candidates = [...text.matchAll(/https:\/\/\S+/g)].reverse();
  for (const candidate of candidates) {
    const artifact = normalizeArtifactUrl(candidate[0].replace(TRAILING_PUNCTUATION, ""));
    if (artifact === undefined) continue;
    const result: ParsedArtifact = { ...artifact };
    const path = PUBLISHED_PATH_PATTERN.exec(text.slice(0, candidate.index))?.[1];
    if (path !== undefined) result.path = path;
    return result;
  }
  return undefined;
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field !== "" ? field : undefined;
}

/**
 * Extracts the artifact an `Artifact` tool call published or opened, or
 * undefined when the output names no https claude.ai artifact URL.
 * `toolUseResult` (the JSONL's structured result) supplies the title and
 * version id when present.
 */
export function parseArtifactOutput(
  resultText: string,
  toolUseResult?: unknown,
): ParsedArtifact | undefined {
  const text = resultText.trim();
  if (text === "") return undefined;
  const prefixed = parsePrefixedOutput(text);
  const parsed =
    parseJsonOutput(text) ?? (prefixed === null ? parsePublishedOutput(text) : prefixed);
  if (parsed === undefined) return undefined;

  const version = readString(toolUseResult, "version") ?? VERSION_ID_PATTERN.exec(text)?.[1];
  if (version !== undefined) parsed.version = version;
  const title = readString(toolUseResult, "title");
  if (title !== undefined) parsed.title = title;
  return parsed;
}

/**
 * Whether an `Artifact` call gets an artifact card: a successful publish
 * (no action, or "publish") or open.
 */
export function isArtifactCardCall(input: unknown, isError: boolean): boolean {
  if (isError || typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const action = (input as Record<string, unknown>)["action"];
  return action === undefined || action === "publish" || action === "open";
}
