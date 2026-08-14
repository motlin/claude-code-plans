import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { readFileSync } from "node:fs";
import type * as schema from "./db/schema";
import { extractSessionFiles, type SessionFiles } from "./session-files";
import { collectSessionLinks, type CollectedLink } from "./session-links";
import { parseTranscriptLine, transcriptFilePath } from "./structured-transcript";
import { processTranscript } from "./transcript";

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * The whole session's files and links, as opposed to the window's.
 *
 * The transcript endpoint serves only a tail (see structured-transcript.ts), so
 * the extraction the browser runs over what it holds can only ever report a
 * floor -- `12+`. Opening a drawer asks for this instead: one pass over the
 * entire JSONL, which on the largest local session (79k lines, 53 MB) costs
 * about 0.6s in total and is dominated by `processTranscript`. Worth paying
 * once, on demand, for an inventory the reader can trust.
 *
 * Links come back uncategorized: `categorizeUrl` depends on the serving host
 * and the reader's own rules, so the browser groups them (`groupSessionLinks`).
 */
export interface SessionResources {
  files: SessionFiles;
  links: CollectedLink[];
}

function emptyResources(homeRoot: string): SessionResources {
  return { files: extractSessionFiles([], homeRoot), links: [] };
}

export function readSessionResources(db: IndexDb, id: string, homeRoot: string): SessionResources {
  const filePath = transcriptFilePath(db, id);
  if (!filePath) return emptyResources(homeRoot);

  let records: Record<string, unknown>[];
  try {
    records = readFileSync(filePath, "utf-8")
      .split("\n")
      .flatMap((line) => {
        if (!line.trim()) return [];
        const record = parseTranscriptLine(line);
        return record ? [record] : [];
      });
  } catch {
    return emptyResources(homeRoot);
  }

  // Record 0 is the file's first record, so every occurrence's `anchorIndex` is
  // session-absolute and comparable with the transcript window's `startIndex`.
  const { lines } = processTranscript(records, 0);
  return {
    files: extractSessionFiles(lines, homeRoot),
    links: collectSessionLinks(lines),
  };
}
