import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FindingSchema, ReviewBundleSchema, reviewQueryOptions } from "../../src/lib/api/reviews";
import { openTestDb, type AppDb } from "../../src/lib/db/connection";
import * as schema from "../../src/lib/db/schema";
import {
  handleCreateReviewRequest,
  handleGetReviewRequest,
  handleReplaceReviewFindingsRequest,
  type ReviewHandlerDependencies,
} from "../../src/lib/reviews";

const SESSION_ID = "session-test-100";
const REVIEW_ID = `local-${SESSION_ID}`;
const SESSION_CWD = "/fixture/alice-repository";
const GENERATED_AT = new Date("2000-01-01T00:00:00.000Z");
const DIFF = [
  "diff --git a/src/alice.ts b/src/alice.ts",
  "--- a/src/alice.ts",
  "+++ b/src/alice.ts",
  "@@ -1 +1 @@",
  "-export const value = 0;",
  "+export const value = 1;",
  "",
].join("\n");

let db: AppDb;

function insertSession(cwd: string | null = SESSION_CWD): void {
  db.index
    .insert(schema.sessions)
    .values({
      id: SESSION_ID,
      projectId: "project-test-100",
      title: "Alice fixture session",
      firstPrompt: "Review the fabricated change",
      summary: "Alice changed the fabricated value.",
      customTitle: null,
      messageCount: 10,
      gitBranch: "main",
      cwd,
      isSidechain: 0,
      createdAt: GENERATED_AT.getTime(),
      mtimeMs: GENERATED_AT.getTime(),
      filePath: `/fixture/transcripts/${SESSION_ID}.jsonl`,
    })
    .run();
}

function dependencies(
  overrides: Partial<ReviewHandlerDependencies> = {},
): ReviewHandlerDependencies {
  return {
    index: db.index,
    buildDiff: async () => DIFF,
    resolveDirectory: async (cwd) => cwd,
    now: () => GENERATED_AT,
    ...overrides,
  };
}

function findingsRequest(body: unknown): Request {
  return new Request(`http://127.0.0.1:7526/api/reviews/${REVIEW_ID}/findings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function describeResponse(response: Response): Promise<{
  body: unknown;
  cacheControl: string | null;
  status: number;
}> {
  return {
    body: await response.json(),
    cacheControl: response.headers.get("Cache-Control"),
    status: response.status,
  };
}

beforeEach(() => {
  db = openTestDb();
});

afterEach(() => {
  db.close();
});

describe("review API contracts", () => {
  it("defaults unresolved findings and rejects undeclared fields", () => {
    const finding = {
      id: "finding-test-100",
      file: "src/alice.ts",
      side: "new" as const,
      line: 10,
      severity: "medium" as const,
      title: "Fabricated finding",
      body: "The fabricated value has no guard.",
    };

    expect({
      finding: FindingSchema.parse(finding),
      findingWithExtraFieldAccepted: FindingSchema.safeParse({ ...finding, extra: true }).success,
      bundleWithExtraFieldAccepted: ReviewBundleSchema.safeParse({
        reviewId: REVIEW_ID,
        sessionId: SESSION_ID,
        cwd: SESSION_CWD,
        diff: DIFF,
        summary: null,
        findings: [],
        generatedAt: GENERATED_AT.toISOString(),
        extra: true,
      }).success,
    }).toStrictEqual({
      finding: {
        id: "finding-test-100",
        file: "src/alice.ts",
        side: "new",
        line: 10,
        severity: "medium",
        title: "Fabricated finding",
        body: "The fabricated value has no guard.",
        resolved: false,
      },
      findingWithExtraFieldAccepted: false,
      bundleWithExtraFieldAccepted: false,
    });
  });

  it("builds review query options with an encoded resource id", () => {
    const options = reviewQueryOptions("local-session/test 100");

    expect({
      queryKey: options.queryKey,
      staleTime: options.staleTime,
      gcTime: options.gcTime,
    }).toStrictEqual({
      queryKey: ["reviews", "local-session/test 100"],
      staleTime: Infinity,
      gcTime: Infinity,
    });
  });
});

describe("review route handlers", () => {
  it("creates and fetches a validated bundle from indexed session metadata", async () => {
    insertSession();
    const resolvedDirectories: string[] = [];
    const diffDirectories: string[] = [];

    const created = await handleCreateReviewRequest(
      SESSION_ID,
      dependencies({
        resolveDirectory: async (cwd) => {
          resolvedDirectories.push(cwd);
          return "/fixture/canonical-alice-repository";
        },
        buildDiff: async (cwd) => {
          diffDirectories.push(cwd);
          return DIFF;
        },
      }),
    );
    const fetched = handleGetReviewRequest(REVIEW_ID, db.index);

    expect({
      created: await describeResponse(created),
      fetched: await describeResponse(fetched),
      resolvedDirectories,
      diffDirectories,
      storedRows: db.index.select().from(schema.reviews).all(),
    }).toStrictEqual({
      created: {
        body: { reviewId: REVIEW_ID },
        cacheControl: "private, max-age=0, must-revalidate",
        status: 200,
      },
      fetched: {
        body: {
          reviewId: REVIEW_ID,
          sessionId: SESSION_ID,
          cwd: "/fixture/canonical-alice-repository",
          diff: DIFF,
          summary: "Alice changed the fabricated value.",
          findings: [],
          generatedAt: GENERATED_AT.toISOString(),
        },
        cacheControl: "private, max-age=0, must-revalidate",
        status: 200,
      },
      resolvedDirectories: [SESSION_CWD],
      diffDirectories: ["/fixture/canonical-alice-repository"],
      storedRows: [
        {
          reviewId: REVIEW_ID,
          bundle: {
            reviewId: REVIEW_ID,
            sessionId: SESSION_ID,
            cwd: "/fixture/canonical-alice-repository",
            diff: DIFF,
            summary: "Alice changed the fabricated value.",
            findings: [],
            generatedAt: GENERATED_AT.toISOString(),
          },
        },
      ],
    });
  });

  it("replaces findings while preserving their exact hunk addressing", async () => {
    insertSession();
    await handleCreateReviewRequest(SESSION_ID, dependencies());

    const response = await handleReplaceReviewFindingsRequest(
      findingsRequest({
        findings: [
          {
            id: "finding-test-100",
            file: "src/alice.ts",
            side: "new",
            line: 10,
            endLine: 12,
            severity: "high",
            title: "Guard the fabricated value",
            body: "The fabricated value can be negative.",
            suggestion: "Math.max(0, value)",
          },
          {
            id: "finding-test-200",
            file: "src/bob.ts",
            side: "old",
            line: 20,
            severity: "nit",
            title: "Rename the fabricated helper",
            body: "The fixture name is ambiguous.",
            resolved: true,
          },
        ],
      }),
      REVIEW_ID,
      db.index,
    );

    expect(await describeResponse(response)).toStrictEqual({
      body: {
        reviewId: REVIEW_ID,
        sessionId: SESSION_ID,
        cwd: SESSION_CWD,
        diff: DIFF,
        summary: "Alice changed the fabricated value.",
        findings: [
          {
            id: "finding-test-100",
            file: "src/alice.ts",
            side: "new",
            line: 10,
            endLine: 12,
            severity: "high",
            title: "Guard the fabricated value",
            body: "The fabricated value can be negative.",
            suggestion: "Math.max(0, value)",
            resolved: false,
          },
          {
            id: "finding-test-200",
            file: "src/bob.ts",
            side: "old",
            line: 20,
            severity: "nit",
            title: "Rename the fabricated helper",
            body: "The fixture name is ambiguous.",
            resolved: true,
          },
        ],
        generatedAt: GENERATED_AT.toISOString(),
      },
      cacheControl: "private, max-age=0, must-revalidate",
      status: 200,
    });
  });

  it("regenerates a review wholesale under the stable local session id", async () => {
    insertSession();
    await handleCreateReviewRequest(SESSION_ID, dependencies());
    await handleReplaceReviewFindingsRequest(
      findingsRequest({
        findings: [
          {
            id: "finding-test-100",
            file: "src/alice.ts",
            side: "new",
            line: 10,
            severity: "low",
            title: "Old fabricated finding",
            body: "This finding should be replaced.",
            resolved: false,
          },
        ],
      }),
      REVIEW_ID,
      db.index,
    );

    const regenerated = await handleCreateReviewRequest(
      SESSION_ID,
      dependencies({
        buildDiff: async () => "diff --git a/new.txt b/new.txt\n",
        now: () => new Date("2000-01-02T00:00:00.000Z"),
      }),
    );
    const stored = handleGetReviewRequest(REVIEW_ID, db.index);

    expect({
      regenerated: await describeResponse(regenerated),
      stored: await describeResponse(stored),
      rowCount: db.index.select().from(schema.reviews).all().length,
    }).toStrictEqual({
      regenerated: {
        body: { reviewId: REVIEW_ID },
        cacheControl: "private, max-age=0, must-revalidate",
        status: 200,
      },
      stored: {
        body: {
          reviewId: REVIEW_ID,
          sessionId: SESSION_ID,
          cwd: SESSION_CWD,
          diff: "diff --git a/new.txt b/new.txt\n",
          summary: "Alice changed the fabricated value.",
          findings: [],
          generatedAt: "2000-01-02T00:00:00.000Z",
        },
        cacheControl: "private, max-age=0, must-revalidate",
        status: 200,
      },
      rowCount: 1,
    });
  });

  it("rejects malformed finding payloads without changing the stored bundle", async () => {
    insertSession();
    await handleCreateReviewRequest(SESSION_ID, dependencies());
    const malformedBodies: unknown[] = [
      [],
      { findings: [], extra: true },
      {
        findings: [
          {
            id: "finding-test-100",
            file: "src/alice.ts",
            side: "both",
            line: 10,
            severity: "medium",
            title: "Invalid fabricated finding",
            body: "This side is not addressable.",
            resolved: false,
          },
        ],
      },
      "{not-json",
    ];

    const responses = [];
    for (const body of malformedBodies) {
      responses.push(
        await describeResponse(
          await handleReplaceReviewFindingsRequest(findingsRequest(body), REVIEW_ID, db.index),
        ),
      );
    }

    expect({
      responses,
      stored: await describeResponse(handleGetReviewRequest(REVIEW_ID, db.index)),
    }).toStrictEqual({
      responses: Array.from({ length: 4 }, () => ({
        body: { error: "Invalid findings payload" },
        cacheControl: "private, max-age=0, must-revalidate",
        status: 400,
      })),
      stored: {
        body: {
          reviewId: REVIEW_ID,
          sessionId: SESSION_ID,
          cwd: SESSION_CWD,
          diff: DIFF,
          summary: "Alice changed the fabricated value.",
          findings: [],
          generatedAt: GENERATED_AT.toISOString(),
        },
        cacheControl: "private, max-age=0, must-revalidate",
        status: 200,
      },
    });
  });

  it("returns precise errors for missing sessions, cwd values, directories, and reviews", async () => {
    const buildDiff = vi.fn<(cwd: string) => Promise<string>>();
    const missingSession = await handleCreateReviewRequest(
      "session-test-missing",
      dependencies({ buildDiff }),
    );

    insertSession(null);
    const missingCwd = await handleCreateReviewRequest(SESSION_ID, dependencies({ buildDiff }));
    db.index.delete(schema.sessions).run();
    insertSession();
    const staleCwd = await handleCreateReviewRequest(
      SESSION_ID,
      dependencies({ buildDiff, resolveDirectory: async () => null }),
    );
    const missingReview = handleGetReviewRequest("local-session-test-missing", db.index);
    const missingFindingsReview = await handleReplaceReviewFindingsRequest(
      findingsRequest({ findings: [] }),
      "local-session-test-missing",
      db.index,
    );

    expect({
      responses: await Promise.all(
        [missingSession, missingCwd, staleCwd, missingReview, missingFindingsReview].map(
          describeResponse,
        ),
      ),
      buildDiffCalls: buildDiff.mock.calls,
    }).toStrictEqual({
      responses: [
        {
          body: { error: "Session not found" },
          cacheControl: "private, max-age=0, must-revalidate",
          status: 404,
        },
        {
          body: { error: "Session has no working directory" },
          cacheControl: "private, max-age=0, must-revalidate",
          status: 422,
        },
        {
          body: { error: "Session working directory is unavailable" },
          cacheControl: "private, max-age=0, must-revalidate",
          status: 422,
        },
        {
          body: { error: "Review not found" },
          cacheControl: "private, max-age=0, must-revalidate",
          status: 404,
        },
        {
          body: { error: "Review not found" },
          cacheControl: "private, max-age=0, must-revalidate",
          status: 404,
        },
      ],
      buildDiffCalls: [],
    });
  });
});
