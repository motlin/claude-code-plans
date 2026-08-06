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
import { getLastSubstantiveAssistantText } from "./db/queries";
import * as schema from "./db/schema";
import { buildWorkingCopyDiff } from "./working-copy-diff";
import { killProcess, spawnClaude } from "./cli-runner";
import { z } from "zod";

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

const ReviewCancelRequestSchema = z
  .object({ action: z.literal("cancel"), processId: z.string() })
  .strict();

export interface ReviewRunDependencies {
  index: IndexDb;
  spawn(options: {
    sessionId: string;
    prompt: string;
    projectDir: string;
    environment: Record<string, string>;
  }): { stream: ReadableStream<Uint8Array>; processId: string };
  kill(processId: string): boolean;
  origin: string;
}

function defaultRunDependencies(): ReviewRunDependencies {
  const port = process.env["PORT"] ?? "7526";
  return {
    index: getDb().index,
    spawn: spawnClaude,
    kill: killProcess,
    origin: `http://127.0.0.1:${port}`,
  };
}

export function buildWorkingCopyReviewPrompt(reviewId: string, origin: string): string {
  return [
    "Use /review-working-copy to review the ccp-provided working-copy bundle.",
    `Review ID: ${reviewId}`,
    `ccp origin: ${origin}`,
    "Follow the skill's fact-isolation and diff-first ordering exactly, then post the findings.",
  ].join("\n");
}

export async function handleRunReviewRequest(
  request: Request,
  reviewId: string,
  dependencies?: ReviewRunDependencies,
): Promise<Response> {
  if (!reviewId) return errorResponse("A review id is required", 400);
  const resolvedDependencies = dependencies ?? defaultRunDependencies();
  const bodyText = await request.text();
  if (bodyText !== "") {
    const body: unknown = JSON.parse(bodyText);
    const cancel = ReviewCancelRequestSchema.safeParse(body);
    if (!cancel.success) return errorResponse("Invalid review run payload", 400);
    return jsonResponse({ ok: resolvedDependencies.kill(cancel.data.processId) });
  }

  const bundle = readReview(resolvedDependencies.index, reviewId);
  if (bundle === null) return errorResponse("Review not found", 404);

  const { stream, processId } = resolvedDependencies.spawn({
    sessionId: bundle.sessionId,
    prompt: buildWorkingCopyReviewPrompt(reviewId, resolvedDependencies.origin),
    projectDir: bundle.cwd,
    // The fork's own Stop hook must not recursively start another review.
    environment: { CLAUDE_CCP_REVIEW_RUN: "1" },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Process-Id": processId,
    },
  });
}

export async function handleCreateReviewRequest(
  sessionId: string,
  dependencies?: ReviewHandlerDependencies,
): Promise<Response> {
  if (!sessionId) return errorResponse("A session id is required", 400);
  const resolvedDependencies = dependencies ?? defaultDependencies();

  const session = resolvedDependencies.index
    .select({ cwd: schema.sessions.cwd })
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
    summary: getLastSubstantiveAssistantText(resolvedDependencies.index, sessionId),
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
