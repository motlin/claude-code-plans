import { statSync } from "node:fs";
import { basename } from "node:path";
import { desc, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { ArtifactSummary } from "../api/artifacts";
import { artifactMatchesSearch } from "../artifact-gallery";
import { isPreviewableSourcePath } from "../artifact-source-paths";
import * as schema from "./schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

/** The source file's mtime in ms when it is still a regular file, else null. */
function statSourceMtime(path: string): number | null {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat.mtimeMs : null;
  } catch {
    return null;
  }
}

/**
 * Every indexed artifact, newest publish first, titled like upstream's card label
 * (title → source basename → id) and optionally narrowed to titles containing `q`.
 * A source counts as existing only when it can be previewed locally.
 */
export function getArtifacts(
  db: IndexDb,
  { q = "" }: { q?: string },
  sourceMtime: (path: string) => number | null = statSourceMtime,
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
    .map((row): ArtifactSummary => {
      const sourceModifiedAt =
        row.sourcePath !== null && isPreviewableSourcePath(row.sourcePath)
          ? sourceMtime(row.sourcePath)
          : null;
      return {
        url: row.url,
        id: row.id,
        kind: row.urlKind === "slug" ? "docs" : "html",
        title: row.title ?? (row.sourcePath ? basename(row.sourcePath) : row.id),
        description: row.description,
        sourcePath: row.sourcePath,
        sourceExists: sourceModifiedAt !== null,
        sourceModifiedAt,
        audience: row.audience,
        firstSeenAt: row.firstSeenAt,
        lastPublishedAt: row.lastPublishedAt,
        publishCount: row.publishCount,
        sessionId: row.lastSessionId,
        projectId: row.projectId,
      };
    })
    .filter((artifact) => artifactMatchesSearch(artifact.title, q));
}
