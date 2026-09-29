import { existsSync } from "node:fs";
import { basename } from "node:path";
import { desc, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { ArtifactSummary } from "../api/artifacts";
import { artifactMatchesSearch } from "../artifact-gallery";
import * as schema from "./schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * Every indexed artifact, newest publish first, titled like upstream's card label
 * (title → source basename → id) and optionally narrowed to titles containing `q`.
 */
export function getArtifacts(
  db: IndexDb,
  { q = "" }: { q?: string },
  sourceExists: (path: string) => boolean = existsSync,
): ArtifactSummary[] {
  const rows = db
    .select()
    .from(schema.artifacts)
    .orderBy(
      desc(sql`coalesce(${schema.artifacts.lastPublishedAt}, ${schema.artifacts.firstSeenAt})`),
      desc(schema.artifacts.firstSeenAt),
    )
    .all();

  return rows
    .map(
      (row): ArtifactSummary => ({
        url: row.url,
        id: row.id,
        kind: row.urlKind === "slug" ? "docs" : "html",
        title: row.title ?? (row.sourcePath ? basename(row.sourcePath) : row.id),
        description: row.description,
        sourcePath: row.sourcePath,
        sourceExists: row.sourcePath !== null && sourceExists(row.sourcePath),
        audience: row.audience,
        firstSeenAt: row.firstSeenAt,
        lastPublishedAt: row.lastPublishedAt,
        publishCount: row.publishCount,
        sessionId: row.lastSessionId,
        projectId: row.projectId,
      }),
    )
    .filter((artifact) => artifactMatchesSearch(artifact.title, q));
}
