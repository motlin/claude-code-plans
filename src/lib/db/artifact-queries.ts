import { statSync } from "node:fs";
import { basename } from "node:path";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { ArtifactSummary, SessionArtifact } from "../api/artifacts";
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

const SESSION_ARTIFACT_ACTIONS = ["publish", "open"];

/**
 * The artifacts a session (or its subagents) published or opened, one row per
 * URL, most recently touched first: upstream's session Artifacts pane frames.
 * The title prefers the session's own latest title, then the artifact's.
 */
export function getSessionArtifacts(db: IndexDb, sessionId: string): SessionArtifact[] {
  const rows = db
    .select({
      event: schema.artifactEvents,
      artifact: schema.artifacts,
    })
    .from(schema.artifactEvents)
    .innerJoin(schema.artifacts, eq(schema.artifacts.url, schema.artifactEvents.url))
    .where(
      and(
        eq(schema.artifactEvents.sessionId, sessionId),
        inArray(schema.artifactEvents.action, SESSION_ARTIFACT_ACTIONS),
      ),
    )
    .orderBy(desc(schema.artifactEvents.ts), desc(schema.artifactEvents.toolUseId))
    .all();

  type Row = (typeof rows)[number];
  const byUrl = new Map<string, { latest: Row; rows: Row[] }>();
  for (const row of rows) {
    const entry = byUrl.get(row.event.url);
    if (entry === undefined) byUrl.set(row.event.url, { latest: row, rows: [row] });
    else entry.rows.push(row);
  }

  return [...byUrl.values()].map(
    ({ latest: { event, artifact }, rows: urlRows }): SessionArtifact => {
      const sourcePath =
        urlRows.find((row) => row.event.sourcePath !== null)?.event.sourcePath ??
        artifact.sourcePath;
      const title =
        urlRows.find((row) => row.event.title !== null)?.event.title ??
        artifact.title ??
        (sourcePath !== null ? basename(sourcePath) : artifact.id);
      return {
        url: event.url,
        id: artifact.id,
        kind: artifact.urlKind === "slug" ? "docs" : "html",
        title,
        previewable: sourcePath !== null && isPreviewableSourcePath(sourcePath),
        lastEventAt: event.ts,
      };
    },
  );
}
