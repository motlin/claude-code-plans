import { eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { normalizeArtifactUrl, parseArtifactOutput } from "../artifact-output";
import * as schema from "./schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

type ArtifactEventRow = typeof schema.artifactEvents.$inferInsert;

type ArtifactEventData = Omit<
  ArtifactEventRow,
  "sessionId" | "projectId" | "filePath" | "isSubagent"
>;

const INDEXED_ACTIONS = new Set(["publish", "open", "read", "read_db", "pin", "unpin"]);
const PUBLISH_ACTION = "publish";

interface PendingCall {
  action: string;
  input: Record<string, unknown>;
  timestamp: string | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const record = asRecord(block);
      return record?.["type"] === "text" && typeof record["text"] === "string"
        ? record["text"]
        : "";
    })
    .join("\n");
}

function parseTimestamp(...candidates: Array<string | undefined>): number | undefined {
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const ms = Date.parse(candidate);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

/**
 * Collects the successful `Artifact` tool calls in one transcript, pairing
 * each assistant tool_use with the user record that carries its result.
 */
export class ArtifactEventCollector {
  private readonly pending = new Map<string, PendingCall>();
  private readonly collected: ArtifactEventData[] = [];

  add(record: unknown): void {
    const obj = asRecord(record);
    if (obj === undefined) return;
    const content = asRecord(obj["message"])?.["content"];
    if (!Array.isArray(content)) return;
    const timestamp = typeof obj["timestamp"] === "string" ? obj["timestamp"] : undefined;

    for (const rawBlock of content) {
      const block = asRecord(rawBlock);
      if (block === undefined) continue;
      if (obj["type"] === "assistant" && block["type"] === "tool_use") {
        this.addToolUse(block, timestamp);
      } else if (obj["type"] === "user" && block["type"] === "tool_result") {
        this.addToolResult(block, obj["toolUseResult"], timestamp);
      }
    }
  }

  events(): ArtifactEventData[] {
    return this.collected;
  }

  private addToolUse(block: Record<string, unknown>, timestamp: string | undefined): void {
    if (block["name"] !== "Artifact" || typeof block["id"] !== "string") return;
    const input = asRecord(block["input"]) ?? {};
    const action = typeof input["action"] === "string" ? input["action"] : PUBLISH_ACTION;
    if (!INDEXED_ACTIONS.has(action)) return;
    this.pending.set(block["id"], { action, input, timestamp });
  }

  private addToolResult(
    block: Record<string, unknown>,
    toolUseResult: unknown,
    timestamp: string | undefined,
  ): void {
    const toolUseId = block["tool_use_id"];
    if (typeof toolUseId !== "string") return;
    const call = this.pending.get(toolUseId);
    if (call === undefined) return;
    this.pending.delete(toolUseId);
    if (block["is_error"] === true) return;

    const ts = parseTimestamp(timestamp, call.timestamp);
    if (ts === undefined) return;
    const { action, input } = call;
    const resultRecord = asRecord(toolUseResult);
    const parsed =
      action === PUBLISH_ACTION || action === "open"
        ? parseArtifactOutput(toolResultText(block["content"]), toolUseResult)
        : undefined;
    const readUrl = asRecord(resultRecord?.["read"])?.["url"];
    const url =
      parsed?.url ??
      (typeof input["url"] === "string" ? normalizeArtifactUrl(input["url"])?.url : undefined) ??
      (typeof readUrl === "string" ? normalizeArtifactUrl(readUrl)?.url : undefined);
    if (url === undefined) return;

    this.collected.push({
      toolUseId,
      ts,
      action,
      url,
      title: parsed?.title ?? nonEmptyString(input["title"]),
      favicon: nonEmptyString(input["favicon"]),
      description: nonEmptyString(input["description"]),
      sourcePath: parsed?.path ?? nonEmptyString(input["file_path"]),
      version: parsed?.version ?? null,
      audience: nonEmptyString(resultRecord?.["audience"]),
    });
  }
}

function lastNonNull<T>(values: ReadonlyArray<T | null | undefined>): T | null {
  for (let index = values.length - 1; index >= 0; index--) {
    const value = values[index];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function firstNonNull<T>(values: ReadonlyArray<T | null | undefined>): T | null {
  return lastNonNull([...values].reverse());
}

function recomputeArtifact(transaction: IndexDb, url: string): void {
  const events = transaction
    .select()
    .from(schema.artifactEvents)
    .where(eq(schema.artifactEvents.url, url))
    .all()
    .sort((a, b) => a.ts - b.ts || a.toolUseId.localeCompare(b.toolUseId));
  const latest = events.at(-1);
  const normalized = normalizeArtifactUrl(url);
  if (latest === undefined || normalized === undefined) {
    transaction.delete(schema.artifacts).where(eq(schema.artifacts.url, url)).run();
    return;
  }

  const publishes = events.filter((event) => event.action === PUBLISH_ACTION);
  const row = {
    url,
    id: normalized.id,
    urlKind: normalized.kind,
    title: lastNonNull(events.map((event) => event.title)),
    favicon: firstNonNull(events.map((event) => event.favicon)),
    description: lastNonNull(events.map((event) => event.description)),
    sourcePath: lastNonNull(events.map((event) => event.sourcePath)),
    version: lastNonNull(events.map((event) => event.version)),
    audience: lastNonNull(events.map((event) => event.audience)),
    firstSeenAt: events[0]?.ts ?? latest.ts,
    lastPublishedAt: publishes.at(-1)?.ts ?? null,
    publishCount: publishes.length,
    lastSessionId: latest.sessionId,
    projectId: latest.projectId,
  };
  transaction
    .insert(schema.artifacts)
    .values(row)
    .onConflictDoUpdate({ target: schema.artifacts.url, set: row })
    .run();
}

function recomputeArtifacts(transaction: IndexDb, urls: Iterable<string>): void {
  for (const url of new Set(urls)) recomputeArtifact(transaction, url);
}

/**
 * Replaces the artifact events one transcript produced and recomputes every
 * artifact those old or new events touch, so a reindex is idempotent.
 */
export function replaceArtifactEvents(
  db: IndexDb,
  source: { filePath: string; sessionId: string; projectId: string; isSubagent: boolean },
  events: readonly ArtifactEventData[],
): void {
  db.transaction((transaction) => {
    const previousUrls = transaction
      .selectDistinct({ url: schema.artifactEvents.url })
      .from(schema.artifactEvents)
      .where(eq(schema.artifactEvents.filePath, source.filePath))
      .all()
      .map((row) => row.url);
    transaction
      .delete(schema.artifactEvents)
      .where(eq(schema.artifactEvents.filePath, source.filePath))
      .run();
    for (const event of events) {
      const row: ArtifactEventRow = {
        ...event,
        sessionId: source.sessionId,
        projectId: source.projectId,
        filePath: source.filePath,
        isSubagent: source.isSubagent ? 1 : 0,
      };
      transaction
        .insert(schema.artifactEvents)
        .values(row)
        .onConflictDoUpdate({ target: schema.artifactEvents.toolUseId, set: row })
        .run();
    }
    recomputeArtifacts(transaction, [...previousUrls, ...events.map((event) => event.url)]);
  });
}

/** Drops every artifact event recorded for the given sessions (main and subagent transcripts). */
export function deleteArtifactEventsForSessions(db: IndexDb, sessionIds: readonly string[]): void {
  if (sessionIds.length === 0) return;
  db.transaction((transaction) => {
    const urls = transaction
      .selectDistinct({ url: schema.artifactEvents.url })
      .from(schema.artifactEvents)
      .where(inArray(schema.artifactEvents.sessionId, [...sessionIds]))
      .all()
      .map((row) => row.url);
    transaction
      .delete(schema.artifactEvents)
      .where(inArray(schema.artifactEvents.sessionId, [...sessionIds]))
      .run();
    recomputeArtifacts(transaction, urls);
  });
}
