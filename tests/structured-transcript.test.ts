import { describe, expect, it, beforeEach, afterEach } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {
  readStructuredTranscript,
  TRANSCRIPT_WINDOW_MAX_BYTES,
  TRANSCRIPT_WINDOW_MAX_RECORDS,
} from "../src/lib/structured-transcript";

/**
 * Tests for the transcript window in `src/lib/structured-transcript.ts`.
 *
 * A long session's JSONL runs to megabytes, so the reader serves the tail of the
 * file and reports where that tail starts; the client pages backwards with
 * `before`. These tests pin the cap, the tail-first ordering, and the
 * `precedingMessageCount` the client needs to keep message positions honest.
 */

let tempDir: string;
let db: AppDb;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "structured-transcript-test-"));
  db = openTestDb();
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

/** Write a JSONL file and index it as a session so the reader can find it. */
function seedSession(sessionId: string, records: unknown[]): void {
  const filePath = join(tempDir, `${sessionId}.jsonl`);
  writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  db.index
    .insert(schema.sessions)
    .values({
      id: sessionId,
      projectId: "test-project",
      title: sessionId,
      createdAt: 0,
      mtimeMs: 0,
      filePath,
    })
    .run();
}

/** A countable user message whose text is `padding` characters long. */
function userMessage(index: number, padding = 0): Record<string, unknown> {
  return {
    type: "user",
    uuid: `u-${index}`,
    message: { role: "user", content: "x".repeat(padding) || `message ${index}` },
  };
}

describe("readStructuredTranscript", () => {
  it("returns every record of a small session starting at index 0", () => {
    seedSession("small", [userMessage(0), userMessage(1), userMessage(2)]);

    const transcript = readStructuredTranscript(db.index, "small");

    expect(transcript.records).toStrictEqual([userMessage(0), userMessage(1), userMessage(2)]);
    expect(transcript.startIndex).toBe(0);
    expect(transcript.precedingMessageCount).toBe(0);
  });

  it("caps the record count and serves the tail of a long session", () => {
    const records = Array.from({ length: TRANSCRIPT_WINDOW_MAX_RECORDS + 25 }, (_, i) =>
      userMessage(i),
    );
    seedSession("long", records);

    const transcript = readStructuredTranscript(db.index, "long");

    expect(transcript.records).toStrictEqual(records.slice(25));
    expect(transcript.startIndex).toBe(25);
    expect(transcript.precedingMessageCount).toBe(25);
  });

  it("caps the serialized size when records are large", () => {
    // 40 KB per record: the byte budget bites long before the record cap.
    const records = Array.from({ length: 100 }, (_, i) => userMessage(i, 40_000));
    seedSession("heavy", records);

    const transcript = readStructuredTranscript(db.index, "heavy");

    expect(JSON.stringify(transcript.records).length).toBeLessThanOrEqual(
      TRANSCRIPT_WINDOW_MAX_BYTES,
    );
    expect(transcript.records.length).toBeLessThan(records.length);
    expect(transcript.records.at(-1)).toStrictEqual(records.at(-1));
    expect(transcript.startIndex).toBe(100 - transcript.records.length);
  });

  it("returns at least one record when a single record blows the byte budget", () => {
    const records = [userMessage(0), userMessage(1, TRANSCRIPT_WINDOW_MAX_BYTES * 2)];
    seedSession("giant", records);

    const transcript = readStructuredTranscript(db.index, "giant");

    expect(transcript.records).toStrictEqual([records[1]]);
    expect(transcript.startIndex).toBe(1);
  });

  it("serves the records before an index when asked for an earlier page", () => {
    const records = Array.from({ length: TRANSCRIPT_WINDOW_MAX_RECORDS + 25 }, (_, i) =>
      userMessage(i),
    );
    seedSession("paged", records);

    const page = readStructuredTranscript(db.index, "paged", { before: 25 });

    expect(page.records).toStrictEqual(records.slice(0, 25));
    expect(page.startIndex).toBe(0);
    expect(page.precedingMessageCount).toBe(0);
  });

  it("counts only countable records before the window", () => {
    const records = [
      userMessage(0),
      { type: "summary", uuid: "s-0", summary: "not a message" },
      { type: "user", uuid: "tr-0", message: { role: "user", content: [{ type: "tool_result" }] } },
      userMessage(1),
      userMessage(2),
    ];
    seedSession("mixed", records);

    const transcript = readStructuredTranscript(db.index, "mixed", { maxRecords: 2 });

    expect(transcript.records).toStrictEqual([records[3], records[4]]);
    expect(transcript.startIndex).toBe(3);
    // Only `userMessage(0)`: the summary and the tool-result-only user record
    // are not messages, so they must not shift the client's message positions.
    expect(transcript.precedingMessageCount).toBe(1);
  });

  it("counts every countable record type before the window and no other", () => {
    // One row per record shape a real session puts in front of the window. The
    // preceding records are never parsed for their content -- only counted --
    // so this fixture is what stops the count from drifting when the scan that
    // produces it changes.
    const preceding: Record<string, unknown>[] = [
      { type: "user", uuid: "p-0", message: { role: "user", content: "string content" } },
      {
        type: "user",
        uuid: "p-1",
        message: { role: "user", content: [{ type: "text", text: "array content" }] },
      },
      {
        type: "assistant",
        uuid: "p-2",
        message: { role: "assistant", content: [{ type: "text", text: "reply" }] },
      },
      {
        type: "assistant",
        uuid: "p-3",
        message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] },
      },
      {
        type: "assistant",
        uuid: "p-4",
        message: { role: "assistant", content: [{ type: "tool_use", id: "t-1", name: "Bash" }] },
      },
      {
        // A tool result alongside text still carries a message.
        type: "user",
        uuid: "p-5",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t-1" },
            { type: "text", text: "and" },
          ],
        },
      },
      // Everything below is not a message.
      {
        type: "user",
        uuid: "p-6",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t-1" }] },
      },
      {
        type: "assistant",
        uuid: "p-7",
        isSidechain: true,
        message: { role: "assistant", content: [{ type: "text", text: "sidechain" }] },
      },
      { type: "summary", uuid: "p-8", summary: "summary" },
      { type: "system", uuid: "p-9", subtype: "turn_duration", durationMs: 12 },
      { type: "attachment", uuid: "p-10", attachment: { type: "file", content: "text" } },
      { type: "queue-operation", uuid: "p-11", operation: "enqueue" },
      { type: "user", uuid: "p-12", message: { role: "user" } },
    ];
    const windowRecords = [userMessage(0), userMessage(1)];
    seedSession("every-type", [...preceding, ...windowRecords]);

    const transcript = readStructuredTranscript(db.index, "every-type", { maxRecords: 2 });

    expect(transcript.records).toStrictEqual(windowRecords);
    expect(transcript.startIndex).toBe(preceding.length);
    expect(transcript.precedingMessageCount).toBe(6);
  });

  it("reports an empty window for an unknown session", () => {
    expect(readStructuredTranscript(db.index, "missing")).toStrictEqual({
      records: [],
      byteOffset: 0,
      startIndex: 0,
      precedingMessageCount: 0,
    });
  });
});
