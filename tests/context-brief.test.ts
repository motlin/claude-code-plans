import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  buildContextBrief,
  CONTEXT_BRIEF_APPROXIMATE_TOKEN_BUDGET,
  CONTEXT_BRIEF_MAX_CHARACTERS,
} from "../src/lib/context-brief";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import {
  getContextBriefProject,
  getMemoriesForProject,
  getOpenTasksForProject,
  getRecentPlansForProject,
} from "../src/lib/db/queries";
import * as schema from "../src/lib/db/schema";
import { handleContextBriefRequest } from "../src/routes/api/context-brief";

const EXAMPLE_CWD = "/workspaces/example";

describe("context brief builder", () => {
  it("builds a title-only decision index in source order", () => {
    expect(
      buildContextBrief({
        projectName: "example",
        openTaskTitles: ["Wire the batch route", "Type the response schema"],
        recentPlanTitles: ["Upstream handover"],
        decisionTitles: ["Use SQLite instead of JSON", "Keep SSE for live transport"],
      }),
    ).toBe(`### Context for example

Open tasks (2):
- Wire the batch route
- Type the response schema

Recent plans:
- Upstream handover

Prior decisions (ask if relevant):
- sqlite-json -> Use SQLite instead of JSON
- keep-sse-live-transport -> Keep SSE for live transport
`);
  });

  it("keeps worst-case input within the documented character and token budgets", () => {
    const body = buildContextBrief({
      projectName: "example-".repeat(30),
      openTaskTitles: Array.from(
        { length: 30 },
        (_, index) => `Task ${index + 1} ${"bounded task title ".repeat(20)}`,
      ),
      recentPlanTitles: Array.from(
        { length: 30 },
        (_, index) => `Plan ${index + 1} ${"bounded plan title ".repeat(20)}`,
      ),
      decisionTitles: Array.from(
        { length: 30 },
        (_, index) => `Decision ${index + 1} ${"bounded decision title ".repeat(20)}`,
      ),
    });

    expect({
      characterBudget: CONTEXT_BRIEF_MAX_CHARACTERS,
      characterCount: body.length,
      estimatedTokenBudget: CONTEXT_BRIEF_APPROXIMATE_TOKEN_BUDGET,
      estimatedTokenCount: Math.ceil(body.length / 4),
      withinBudget:
        body.length <= CONTEXT_BRIEF_MAX_CHARACTERS &&
        Math.ceil(body.length / 4) <= CONTEXT_BRIEF_APPROXIMATE_TOKEN_BUDGET,
    }).toStrictEqual({
      characterBudget: 4_000,
      characterCount: 3_246,
      estimatedTokenBudget: 1_000,
      estimatedTokenCount: 812,
      withinBudget: true,
    });
  });
});

describe("context brief route", () => {
  const input = {
    projectName: "example",
    openTaskTitles: ["Ship the example"],
    recentPlanTitles: [],
    decisionTitles: [],
  };

  it("returns a plain-text brief for a known cwd", async () => {
    const response = handleContextBriefRequest(
      new Request(`http://127.0.0.1:7526/api/context-brief?cwd=${encodeURIComponent(EXAMPLE_CWD)}`),
      {
        load: (cwd) => (cwd === EXAMPLE_CWD ? input : null),
        build: buildContextBrief,
      },
    );

    expect({
      body: await response.text(),
      cacheControl: response.headers.get("Cache-Control"),
      contentType: response.headers.get("Content-Type"),
      status: response.status,
    }).toStrictEqual({
      body: `### Context for example

Open tasks (1):
- Ship the example

Recent plans:
- None

Prior decisions (ask if relevant):
- None indexed
`,
      cacheControl: "private, max-age=0, must-revalidate",
      contentType: "text/plain; charset=utf-8",
      status: 200,
    });
  });

  it("returns an empty plain-text body for an unknown cwd or loading error", async () => {
    const unknownResponse = handleContextBriefRequest(
      new Request("http://127.0.0.1:7526/api/context-brief?cwd=%2Fworkspaces%2Funknown"),
      { load: () => null, build: buildContextBrief },
    );
    const errorResponse = handleContextBriefRequest(
      new Request(`http://127.0.0.1:7526/api/context-brief?cwd=${encodeURIComponent(EXAMPLE_CWD)}`),
      {
        load: () => {
          throw new Error("fabricated database failure");
        },
        build: buildContextBrief,
      },
    );

    expect({
      error: {
        body: await errorResponse.text(),
        contentType: errorResponse.headers.get("Content-Type"),
        status: errorResponse.status,
      },
      unknown: {
        body: await unknownResponse.text(),
        contentType: unknownResponse.headers.get("Content-Type"),
        status: unknownResponse.status,
      },
    }).toStrictEqual({
      error: { body: "", contentType: "text/plain; charset=utf-8", status: 200 },
      unknown: { body: "", contentType: "text/plain; charset=utf-8", status: 200 },
    });
  });
});

describe("context brief database selection", () => {
  let db: AppDb;

  beforeEach(() => {
    db = openTestDb();
    db.index
      .insert(schema.projects)
      .values([
        {
          id: "project-example-100",
          name: "example",
          projectPath: EXAMPLE_CWD,
          updatedAt: 946_684_800_000,
        },
        {
          id: "project-other-100",
          name: "other",
          projectPath: "/workspaces/other",
          updatedAt: 946_598_400_000,
        },
      ])
      .run();
    db.index
      .insert(schema.sessions)
      .values([
        {
          id: "session-example-100",
          projectId: "project-example-100",
          title: "Example session",
          messageCount: 1,
          isSidechain: 0,
          createdAt: 946_684_800_000,
          mtimeMs: 946_684_800_000,
          filePath: "/fixtures/example-session.jsonl",
        },
        {
          id: "session-other-100",
          projectId: "project-other-100",
          title: "Other session",
          messageCount: 1,
          isSidechain: 0,
          createdAt: 946_598_400_000,
          mtimeMs: 946_598_400_000,
          filePath: "/fixtures/other-session.jsonl",
        },
      ])
      .run();
  });

  afterEach(() => {
    db.close();
  });

  it("resolves exact cwd identity and joins open tasks through owning sessions", () => {
    db.index
      .insert(schema.tasks)
      .values([
        {
          filePath: "/fixtures/tasks/session-example-100/in-progress.json",
          taskId: "task-in-progress-100",
          projectDir: "session-example-100",
          subject: "In-progress example task",
          description: "Fabricated task",
          status: "in_progress",
          mtimeMs: 946_684_800_000,
        },
        {
          filePath: "/fixtures/tasks/session-example-100/pending.json",
          taskId: "task-pending-100",
          projectDir: "session-example-100",
          subject: "Pending example task",
          description: "Fabricated task",
          status: "pending",
          mtimeMs: 946_598_400_000,
        },
        {
          filePath: "/fixtures/tasks/session-example-100/completed.json",
          taskId: "task-completed-100",
          projectDir: "session-example-100",
          subject: "Completed example task",
          description: "Fabricated task",
          status: "completed",
          mtimeMs: 946_684_800_000,
        },
        {
          filePath: "/fixtures/tasks/session-other-100/pending.json",
          taskId: "task-other-100",
          projectDir: "session-other-100",
          subject: "Other project task",
          description: "Fabricated task",
          status: "pending",
          mtimeMs: 946_684_800_000,
        },
      ])
      .run();

    expect({
      project: getContextBriefProject(db.index, EXAMPLE_CWD),
      tasks: getOpenTasksForProject(db.index, "project-example-100", 10).map((task) => ({
        sessionId: task.projectDir,
        status: task.status,
        subject: task.subject,
      })),
      unknownProject: getContextBriefProject(db.index, "/workspaces/unknown"),
    }).toStrictEqual({
      project: { id: "project-example-100", name: "example" },
      tasks: [
        {
          sessionId: "session-example-100",
          status: "in_progress",
          subject: "In-progress example task",
        },
        {
          sessionId: "session-example-100",
          status: "pending",
          subject: "Pending example task",
        },
      ],
      unknownProject: null,
    });
  });

  it("returns only project-linked recent plans and recency-ordered decision titles", () => {
    db.index
      .insert(schema.plans)
      .values([
        { filename: "old.md", title: "Old example plan", mtimeMs: 946_598_400_000 },
        { filename: "new.md", title: "New example plan", mtimeMs: 946_684_800_000 },
        { filename: "other.md", title: "Other project plan", mtimeMs: 946_771_200_000 },
      ])
      .run();
    db.index
      .insert(schema.planSessions)
      .values([
        {
          planFilename: "old.md",
          sessionId: "session-example-100",
          projectId: "project-example-100",
        },
        {
          planFilename: "new.md",
          sessionId: "session-example-100",
          projectId: "project-example-100",
        },
        {
          planFilename: "other.md",
          sessionId: "session-other-100",
          projectId: "project-other-100",
        },
      ])
      .run();
    db.index
      .insert(schema.memories)
      .values([
        {
          filePath: "/fixtures/memory/zeta.md",
          projectId: "project-example-100",
          filename: "zeta.md",
          title: "Zeta decision",
          mtimeMs: 946_684_800_000,
        },
        {
          filePath: "/fixtures/memory/alpha.md",
          projectId: "project-example-100",
          filename: "alpha.md",
          title: "Alpha decision",
          mtimeMs: 946_684_800_000,
        },
        {
          filePath: "/fixtures/memory/other.md",
          projectId: "project-other-100",
          filename: "other.md",
          title: "Other decision",
          mtimeMs: 946_771_200_000,
        },
      ])
      .run();

    expect({
      decisions: getMemoriesForProject(db.index, "project-example-100"),
      newestPlanOnly: getRecentPlansForProject(db.index, "project-example-100", 1),
    }).toStrictEqual({
      decisions: [
        { filename: "alpha.md", title: "Alpha decision", mtimeMs: 946_684_800_000 },
        { filename: "zeta.md", title: "Zeta decision", mtimeMs: 946_684_800_000 },
      ],
      newestPlanOnly: [{ filename: "new.md", title: "New example plan", mtimeMs: 946_684_800_000 }],
    });
  });
});
