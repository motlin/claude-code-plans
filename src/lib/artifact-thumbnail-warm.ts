import {max} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {captureArtifactThumbnail, ensureArtifactThumbnail} from "./artifact-thumbnail";
import {getArtifacts} from "./db/artifact-queries";
import * as schema from "./db/schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

let warming:
{
	db: IndexDb;
	cacheDir: string;
	lastPublishedAt: number | null | undefined;
} | null = null;

/** Screenshots every HTML artifact whose current source has no cached thumbnail yet. */
async function warmArtifactThumbnails(db: IndexDb, cacheDir: string): Promise<void>
{
	const pending = getArtifacts(db, {}).filter((artifact) => artifact.sourceExists && artifact.thumbnailUrl !== null);
	await Promise.all(
		pending.map(async (artifact) =>
			ensureArtifactThumbnail(
				db,
				artifact.id,
				{
					cacheDir,
					capture: captureArtifactThumbnail,
				},
			),
		),
	);
}

/**
 * Captures thumbnails as soon as artifacts are published, not only when the gallery asks, so a cover outlives a
 * scratchpad source deleted before anyone looked. Only the server turns this on; tests never launch a browser.
 */
export function enableArtifactThumbnailWarming(db: IndexDb, cacheDir: string): void
{
	warming =
	{
		db,
		cacheDir,
		lastPublishedAt: undefined,
	};
	artifactsMaybePublished();
}

/** Called after each transcript index: warms thumbnails when the newest publish moved. */
export function artifactsMaybePublished(): void
{
	if (warming === null) return;
	const latest =
		warming.db
			.select(
				{
					latest: max(schema.artifacts.lastPublishedAt),
				},
			)
			.from(schema.artifacts)
			.get()?.latest ?? null;
	if (latest === warming.lastPublishedAt) return;
	warming.lastPublishedAt = latest;
	warmArtifactThumbnails(warming.db, warming.cacheDir).catch((error: unknown) =>
	{
		console.warn("[artifact-thumbnail] warming failed:", error);
	});
}
