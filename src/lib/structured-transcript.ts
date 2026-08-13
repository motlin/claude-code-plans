import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { readFileSync, statSync } from "node:fs";
import * as schema from "./db/schema";
import { getSubagentById } from "./db/queries";
import { isCountableMessageRecord } from "./message-count";

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * Budget for one transcript window.
 *
 * A long session's JSONL runs to megabytes -- one measured session was 5 MB in
 * a single response -- and the browser cannot paint a message until the whole
 * body has arrived. So the endpoint serves the tail of the file, which is what
 * the reader wants to see first, and the client pages backwards with `before`.
 * The two caps work together: the byte budget keeps the response small when a
 * few tool results dominate, the record cap keeps the DOM small when the tail
 * is thousands of tiny records.
 */
export const TRANSCRIPT_WINDOW_MAX_BYTES = 512 * 1024;
export const TRANSCRIPT_WINDOW_MAX_RECORDS = 400;

export interface StructuredTranscript {
  records: Record<string, unknown>[];
  byteOffset: number;
  /** Index of `records[0]` within the session's full JSONL record list. */
  startIndex: number;
  /**
   * Countable messages (see message-count.ts) in the records before
   * `startIndex`. Message positions are shared with the viewed-state counter
   * and the session list, so a windowed transcript still has to report where
   * its first record sits in the session's message numbering.
   */
  precedingMessageCount: number;
}

export interface TranscriptWindowOptions {
  /** Exclusive upper bound: the window ends just before this record index. */
  before?: number | undefined;
  maxBytes?: number | undefined;
  maxRecords?: number | undefined;
}

const EMPTY_TRANSCRIPT: StructuredTranscript = {
  records: [],
  byteOffset: 0,
  startIndex: 0,
  precedingMessageCount: 0,
};

function parseLine(line: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Walk backwards from `end` while the window still fits both budgets. Always
 * yields at least one record: a single record over the byte budget is still
 * better than an empty transcript.
 */
function findWindowStart(lines: string[], end: number, maxBytes: number, maxRecords: number) {
  let start = end;
  let bytes = 0;
  while (start > 0) {
    const size = Buffer.byteLength(lines[start - 1]!, "utf8") + 1;
    if (start < end && (bytes + size > maxBytes || end - start >= maxRecords)) break;
    bytes += size;
    start -= 1;
  }
  return start;
}

export function readStructuredTranscript(
  db: IndexDb,
  id: string,
  options: TranscriptWindowOptions = {},
): StructuredTranscript {
  const session = db
    .select({ filePath: schema.sessions.filePath })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .get();
  const filePath = session?.filePath ?? getSubagentById(db, id)?.filePath;
  if (!filePath) return EMPTY_TRANSCRIPT;

  const maxBytes = options.maxBytes ?? TRANSCRIPT_WINDOW_MAX_BYTES;
  const maxRecords = options.maxRecords ?? TRANSCRIPT_WINDOW_MAX_RECORDS;

  try {
    const byteOffset = statSync(filePath).size;
    const lines = readFileSync(filePath, "utf-8")
      .split("\n")
      .filter((line) => line.trim());
    const end = Math.max(0, Math.min(options.before ?? lines.length, lines.length));
    const startIndex = findWindowStart(lines, end, maxBytes, maxRecords);

    const records: Record<string, unknown>[] = [];
    for (const line of lines.slice(startIndex, end)) {
      const record = parseLine(line);
      if (record) records.push(record);
    }

    let precedingMessageCount = 0;
    for (let i = 0; i < startIndex; i += 1) {
      if (isCountableMessageRecord(parseLine(lines[i]!))) precedingMessageCount += 1;
    }

    return { records, byteOffset, startIndex, precedingMessageCount };
  } catch {
    return EMPTY_TRANSCRIPT;
  }
}
