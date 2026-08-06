import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { realpath, stat } from "node:fs/promises";
import {
  ReviewBundleSchema,
  ReviewErrorResponseSchema,
  ReviewFindingsRequestSchema,
  ReviewIdResponseSchema,
  type ReviewBundle,
} from "./api/reviews";
import { getDb } from "./db";
import * as schema from "./db/schema";
import { buildWorkingCopyDiff } from "./working-copy-diff";

type IndexDb = BetterSQLite3Database<typeof schema>;

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

export interface ReviewHandlerDependencies {
  index: IndexDb;
  buildDiff(cwd: string): Promise<string>;
  resolveDirectory(cwd: string): Promise<string | null>;
  now(): Date;
}

function defaultDependencies(): ReviewHandlerDependencies {
  return {
    index: getDb().index,
    buildDiff: buildWorkingCopyDiff,
    resolveDirectory: resolveReviewDirectory,
    now: () => new Date(),
  };
}

async function resolveReviewDirectory(cwd: string): Promise<string | null> {
  try {
    const resolved = await realpath(cwd);
    return (await stat(resolved)).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": PRIVATE_NO_CACHE },
  });
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse(ReviewErrorResponseSchema.parse({ error }), status);
}

function readReview(index: IndexDb, reviewId: string): ReviewBundle | null {
  const row = index
    .select({ bundle: schema.reviews.bundle })
    .from(schema.reviews)
    .where(eq(schema.reviews.reviewId, reviewId))
    .get();
  return row ? ReviewBundleSchema.parse(row.bundle) : null;
}

function writeReview(index: IndexDb, bundle: ReviewBundle): void {
  index
    .insert(schema.reviews)
    .values({ reviewId: bundle.reviewId, bundle })
    .onConflictDoUpdate({
      target: schema.reviews.reviewId,
      set: { bundle },
    })
    .run();
}

export async function handleCreateReviewRequest(
  sessionId: string,
  dependencies?: ReviewHandlerDependencies,
): Promise<Response> {
  if (!sessionId) return errorResponse("A session id is required", 400);
  const resolvedDependencies = dependencies ?? defaultDependencies();

  const session = resolvedDependencies.index
    .select({ cwd: schema.sessions.cwd, summary: schema.sessions.summary })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
  if (!session) return errorResponse("Session not found", 404);
  if (!session.cwd) return errorResponse("Session has no working directory", 422);

  const cwd = await resolvedDependencies.resolveDirectory(session.cwd);
  if (cwd === null) return errorResponse("Session working directory is unavailable", 422);

  const bundle = ReviewBundleSchema.parse({
    reviewId: `local-${sessionId}`,
    sessionId,
    cwd,
    diff: await resolvedDependencies.buildDiff(cwd),
    summary: session.summary,
    findings: [],
    generatedAt: resolvedDependencies.now().toISOString(),
  });
  writeReview(resolvedDependencies.index, bundle);

  return jsonResponse(ReviewIdResponseSchema.parse({ reviewId: bundle.reviewId }));
}

export function handleGetReviewRequest(reviewId: string, index?: IndexDb): Response {
  if (!reviewId) return errorResponse("A review id is required", 400);
  const resolvedIndex = index ?? getDb().index;

  const bundle = readReview(resolvedIndex, reviewId);
  if (bundle === null) return errorResponse("Review not found", 404);
  return jsonResponse(bundle);
}

export async function handleReplaceReviewFindingsRequest(
  request: Request,
  reviewId: string,
  index?: IndexDb,
): Promise<Response> {
  if (!reviewId) return errorResponse("A review id is required", 400);

  const json: unknown = await request.json().catch(() => null);
  const parsed = ReviewFindingsRequestSchema.safeParse(json);
  if (!parsed.success) return errorResponse("Invalid findings payload", 400);

  const resolvedIndex = index ?? getDb().index;
  const bundle = readReview(resolvedIndex, reviewId);
  if (bundle === null) return errorResponse("Review not found", 404);

  const updated = ReviewBundleSchema.parse({ ...bundle, findings: parsed.data.findings });
  writeReview(resolvedIndex, updated);
  return jsonResponse(updated);
}
