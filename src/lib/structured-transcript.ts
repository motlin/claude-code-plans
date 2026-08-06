import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { readFileSync, statSync } from "node:fs";
import * as schema from "./db/schema";
import { getSubagentById } from "./db/queries";

type IndexDb = BetterSQLite3Database<typeof schema>;

export interface StructuredTranscript {
  records: Record<string, unknown>[];
  byteOffset: number;
}

export function readStructuredTranscript(db: IndexDb, id: string): StructuredTranscript {
  const session = db
    .select({ filePath: schema.sessions.filePath })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .get();
  const filePath = session?.filePath ?? getSubagentById(db, id)?.filePath;
  if (!filePath) return { records: [], byteOffset: 0 };

  try {
    const byteOffset = statSync(filePath).size;
    const records = readFileSync(filePath, "utf-8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    return { records, byteOffset };
  } catch {
    return { records: [], byteOffset: 0 };
  }
}
