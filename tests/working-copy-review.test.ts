import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import { indexJsonlFile } from "../src/lib/db/indexer";
import { getLastSubstantiveAssistantText } from "../src/lib/db/queries";
import * as schema from "../src/lib/db/schema";
import {
  buildWorkingCopyReviewPrompt,
  handleCreateReviewRequest,
  handleGetReviewRequest,
  handleReplaceReviewFindingsRequest,
  handleRunReviewRequest,
} from "../src/lib/reviews";
import { buildWorkingCopyDiff } from "../src/lib/working-copy-diff";
import { findingsForDiffLine, parseReviewDiff } from "../src/lib/review-diff";

const TEST_ROOT = join(process.cwd(), ".llm", `working-copy-review-test-${process.pid}`);
const SESSION_ID = "session-test-100";
let db: AppDb;

function insertSession(cwd: string): void {
  db.index
    .insert(schema.projects)
    .values({ id: "project-test-100", name: "example", projectPath: cwd, updatedAt: 0 })
    .run();
  db.index
    .insert(schema.sessions)
    .values({
      id: SESSION_ID,
      projectId: "project-test-100",
      title: "Review example",
      firstPrompt: null,
      summary: "Stale session summary",
      customTitle: null,
      messageCount: 4,
      gitBranch: "main",
      cwd,
      isSidechain: 0,
      createdAt: 946_598_400_000,
      mtimeMs: 946_684_800_000,
      filePath: join(cwd, `${SESSION_ID}.jsonl`),
    })
    .run();
}

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
  db = openTestDb();
});

afterEach(() => {
  db.close();
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("indexed review summary", () => {
  it("returns the last assistant text with content and skips tool-only turns", async () => {
    const project = "-tmp-example";
    const transcript = join(TEST_ROOT, `${SESSION_ID}.jsonl`);
    const records = [
      { type: "user", cwd: TEST_ROOT, message: { content: "Please fix it" } },
      {
        type: "assistant",
        cwd: TEST_ROOT,
        message: { content: [{ type: "text", text: "Implemented the safe path." }] },
      },
      {
        type: "assistant",
        cwd: TEST_ROOT,
        message: { content: [{ type: "tool_use", id: "tool-test-100", name: "Read" }] },
      },
      {
        type: "assistant",
        cwd: TEST_ROOT,
        message: { content: [{ type: "text", text: "  " }] },
      },
    ];
    writeFileSync(transcript, records.map((record) => JSON.stringify(record)).join("\n"));

    await indexJsonlFile(db.index, transcript, project);

    expect({
      rows: db.index
        .select()
        .from(schema.sessionMessages)
        .orderBy(schema.sessionMessages.messageIndex)
        .all(),
      summary: getLastSubstantiveAssistantText(db.index, SESSION_ID),
    }).toStrictEqual({
      rows: [
        { sessionId: SESSION_ID, messageIndex: 0, role: "user", text: "Please fix it" },
        {
          sessionId: SESSION_ID,
          messageIndex: 1,
          role: "assistant",
          text: "Implemented the safe path.",
        },
        { sessionId: SESSION_ID, messageIndex: 2, role: "assistant", text: null },
        { sessionId: SESSION_ID, messageIndex: 3, role: "assistant", text: null },
      ],
      summary: "Implemented the safe path.",
    });
  });
});

describe("review skill runner", () => {
  it("spawns a marked Claude fork with the ccp review prompt and supports cancellation", async () => {
    insertSession(TEST_ROOT);
    db.index
      .insert(schema.sessionMessages)
      .values({ sessionId: SESSION_ID, messageIndex: 0, role: "assistant", text: "Ready." })
      .run();
    await handleCreateReviewRequest(SESSION_ID, {
      index: db.index,
      buildDiff: async () => "diff --git a/example.ts b/example.ts",
      resolveDirectory: async () => TEST_ROOT,
      now: () => new Date("2000-01-01T00:00:00.000Z"),
    });

    const spawned: unknown[] = [];
    const response = await handleRunReviewRequest(
      new Request("http://127.0.0.1:7526/api/reviews/local-session-test-100/run", {
        method: "POST",
      }),
      `local-${SESSION_ID}`,
      {
        index: db.index,
        spawn: (options) => {
          spawned.push(options);
          return {
            processId: "process-test-100",
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"type":"result"}\n'));
                controller.close();
              },
            }),
          };
        },
        kill: (processId) => processId === "process-test-100",
        origin: "http://127.0.0.1:7526",
      },
    );

    const cancelResponse = await handleRunReviewRequest(
      new Request("http://127.0.0.1:7526/api/reviews/local-session-test-100/run", {
        method: "POST",
        body: JSON.stringify({ action: "cancel", processId: "process-test-100" }),
      }),
      `local-${SESSION_ID}`,
      {
        index: db.index,
        spawn: () => {
          throw new Error("cancel must not spawn");
        },
        kill: (processId) => processId === "process-test-100",
        origin: "http://127.0.0.1:7526",
      },
    );

    expect({
      status: response.status,
      processId: response.headers.get("X-Process-Id"),
      output: await response.text(),
      spawned,
      cancelled: await cancelResponse.json(),
    }).toStrictEqual({
      status: 200,
      processId: "process-test-100",
      output: '{"type":"result"}\n',
      spawned: [
        {
          sessionId: SESSION_ID,
          prompt: buildWorkingCopyReviewPrompt(`local-${SESSION_ID}`, "http://127.0.0.1:7526"),
          projectDir: TEST_ROOT,
          environment: { CLAUDE_CCP_REVIEW_RUN: "1" },
        },
      ],
      cancelled: { ok: true },
    });
  });
});

describe("deterministic working-copy review forward test", () => {
  it("pins a fake review finding to the deliberately buggy changed line", async () => {
    const repository = join(TEST_ROOT, "repository");
    mkdirSync(repository);
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repository });
    execFileSync("git", ["config", "user.email", "alice@example.com"], { cwd: repository });
    execFileSync("git", ["config", "user.name", "Alice"], { cwd: repository });
    const sourcePath = join(repository, "average.ts");
    writeFileSync(
      sourcePath,
      "export function average(total: number): number {\n  return total;\n}\n",
    );
    execFileSync("git", ["add", "average.ts"], { cwd: repository });
    execFileSync("git", ["commit", "--quiet", "--message", "Add example average."], {
      cwd: repository,
    });
    writeFileSync(
      sourcePath,
      "export function average(total: number, items: number[]): number {\n  return total / items.length;\n}\n",
    );
    insertSession(repository);
    db.index
      .insert(schema.sessionMessages)
      .values({
        sessionId: SESSION_ID,
        messageIndex: 0,
        role: "assistant",
        text: "Changed the average helper.",
      })
      .run();

    const createResponse = await handleCreateReviewRequest(SESSION_ID, {
      index: db.index,
      buildDiff: buildWorkingCopyDiff,
      resolveDirectory: async () => repository,
      now: () => new Date("2000-01-01T00:00:00.000Z"),
    });
    expect(await createResponse.json()).toStrictEqual({ reviewId: `local-${SESSION_ID}` });

    const fakeFinding = {
      id: "finding-test-100",
      file: "average.ts",
      side: "new" as const,
      line: 2,
      severity: "high" as const,
      title: "Empty input returns NaN",
      body: "Dividing by items.length is undefined for an empty collection.",
      resolved: false,
    };
    const postResponse = await handleReplaceReviewFindingsRequest(
      new Request("http://127.0.0.1:7526/api/reviews/local-session-test-100/findings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findings: [fakeFinding] }),
      }),
      `local-${SESSION_ID}`,
      db.index,
    );
    expect(postResponse.status).toBe(200);

    const reviewResponse = handleGetReviewRequest(`local-${SESSION_ID}`, db.index);
    const review = (await reviewResponse.json()) as {
      diff: string;
      findings: (typeof fakeFinding)[];
      summary: string;
    };
    const file = parseReviewDiff(review.diff)[0];
    if (!file) throw new Error("Expected a changed file");
    const line = file.lines.find((candidate) => candidate.newLine === 2);
    if (!line) throw new Error("Expected changed line 2");

    expect({
      summary: review.summary,
      line: { file: file.file, content: line.content, newLine: line.newLine },
      findings: findingsForDiffLine(review.findings, file.file, line),
    }).toStrictEqual({
      summary: "Changed the average helper.",
      line: { file: "average.ts", content: "  return total / items.length;", newLine: 2 },
      findings: [fakeFinding],
    });
  });
});

describe("review-working-copy skill instructions", () => {
  it("keeps the backend-only and diff-first rules explicit and ordered", () => {
    const skill = readFileSync(
      join(process.cwd(), ".claude", "skills", "review-working-copy", "SKILL.md"),
      "utf8",
    );
    const diffPass = skill.indexOf("## Review the diff in isolation");
    const reconcilePass = skill.indexOf("## Reconcile after discovery");

    expect({
      frontmatterKeys: skill
        .split("---")[1]!
        .trim()
        .split("\n")
        .map((line) => line.split(":")[0]),
      forbidsGit: skill.includes("Do not run `git`, `gh`, or a code-review MCP"),
      getRoute: skill.includes("/api/reviews/<review-id>"),
      postRoute: skill.includes("/api/reviews/<review-id>/findings"),
      diffBeforeReconcile: diffPass > 0 && diffPass < reconcilePass,
    }).toStrictEqual({
      frontmatterKeys: ["name", "description"],
      forbidsGit: true,
      getRoute: true,
      postRoute: true,
      diffBeforeReconcile: true,
    });
  });
});
