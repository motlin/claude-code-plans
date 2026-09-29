import { mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { UnifiedSearchResponse, type UnifiedSearchItem } from "../src/lib/api/search";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import { deleteMemoryFile, fullScan, indexFile } from "../src/lib/db/indexer";
import * as schema from "../src/lib/db/schema";
import { handleUnifiedSearchRequest } from "../src/routes/api/search";

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const PROJECT = "-tmp-alice-project";

describe("docs_fts plan and memory index", () => {
  let fixtureDirectory: string;
  let projectsDir: string;
  let plansDir: string;
  let memoryDir: string;
  let db: AppDb;

  beforeEach(() => {
    fixtureDirectory = join(realpathSync(tmpdir()), `claude-docs-fts-${process.pid}-${Date.now()}`);
    projectsDir = join(fixtureDirectory, "projects");
    plansDir = join(fixtureDirectory, "plans");
    memoryDir = join(projectsDir, PROJECT, "memory");
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(plansDir, { recursive: true });
    db = openTestDb();
    db.index
      .insert(schema.projects)
      .values({ id: PROJECT, name: "project", projectPath: "/tmp/alice/project", updatedAt: 1 })
      .run();
  });

  afterEach(() => {
    db.close();
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  function writeDoc(path: string, content: string, mtimeSeconds: number): void {
    writeFileSync(path, content);
    utimesSync(path, mtimeSeconds, mtimeSeconds);
  }

  async function search(parameters: Record<string, string>): Promise<UnifiedSearchItem[]> {
    const url = `http://localhost/api/search?${new URLSearchParams(parameters).toString()}`;
    const response = handleUnifiedSearchRequest(new Request(url), db.index, NOW);
    expect(response.status).toBe(200);
    return UnifiedSearchResponse.parse(await response.json()).items;
  }

  function docsRows(): unknown[] {
    return db.index.all(sql`SELECT path, kind FROM docs_fts ORDER BY path`);
  }

  it("fullScan indexes a plan and search type=plans returns it with a snippet and md-slug href", async () => {
    const planPath = join(plansDir, "rollout-plan.md");
    writeDoc(planPath, "# Rollout plan\n\nMigrate the platypus database first.\n", 946_684_800);

    await fullScan(db.index, db.summaries, projectsDir, undefined, plansDir);

    expect(await search({ query: "platypus", type: "plans" })).toStrictEqual([
      {
        kind: "plan",
        id: planPath,
        title: "Rollout plan",
        titleMatches: [],
        snippet: {
          text: "# Rollout plan\n\nMigrate the platypus database first.\n",
          matches: [{ start: 28, end: 36 }],
        },
        href: "/plan/rollout-plan",
        projectId: "",
        projectName: "",
        mtime: new Date(946_684_800_000).toISOString(),
      },
    ]);
  });

  it("reports title matches for a plan", async () => {
    const planPath = join(plansDir, "rollout-plan.md");
    writeDoc(planPath, "# Rollout plan\n\nMigrate the platypus database first.\n", 946_684_800);
    await indexFile(db.index, planPath, projectsDir, plansDir);

    const [item] = await search({ query: "rollout", type: "plans" });
    expect({ title: item?.title, titleMatches: item?.titleMatches }).toStrictEqual({
      title: "Rollout plan",
      titleMatches: [{ start: 0, end: 7 }],
    });
  });

  it("editing a plan replaces its indexed content", async () => {
    const planPath = join(plansDir, "rollout-plan.md");
    writeDoc(planPath, "# Rollout plan\n\nMigrate the platypus database first.\n", 946_684_800);
    await indexFile(db.index, planPath, projectsDir, plansDir);
    writeDoc(planPath, "# Rollout plan\n\nMigrate the wombat database first.\n", 946_684_900);
    await indexFile(db.index, planPath, projectsDir, plansDir);

    expect({
      platypus: await search({ query: "platypus", type: "plans" }),
      wombat: (await search({ query: "wombat", type: "plans" })).map((item) => item.id),
      rows: docsRows(),
    }).toStrictEqual({
      platypus: [],
      wombat: [planPath],
      rows: [{ path: planPath, kind: "plan" }],
    });
  });

  it("deleting a plan file removes it from the index", async () => {
    const planPath = join(plansDir, "rollout-plan.md");
    writeDoc(planPath, "# Rollout plan\n\nMigrate the platypus database first.\n", 946_684_800);
    await indexFile(db.index, planPath, projectsDir, plansDir);
    rmSync(planPath);
    await indexFile(db.index, planPath, projectsDir, plansDir);

    expect({
      hits: await search({ query: "platypus" }),
      rows: docsRows(),
    }).toStrictEqual({ hits: [], rows: [] });
  });

  it("fullScan prunes a plan whose file disappeared", async () => {
    const planPath = join(plansDir, "rollout-plan.md");
    writeDoc(planPath, "# Rollout plan\n\nMigrate the platypus database first.\n", 946_684_800);
    await fullScan(db.index, db.summaries, projectsDir, undefined, plansDir);
    rmSync(planPath);
    await fullScan(db.index, db.summaries, projectsDir, undefined, plansDir);

    expect(docsRows()).toStrictEqual([]);
  });

  it("indexes memories with their project and a md-slug href", async () => {
    const memoryPath = join(memoryDir, "feedback_tests.md");
    writeDoc(memoryPath, "# Test preferences\n\nAlways feed the platypus.\n", 946_684_800);

    await fullScan(db.index, db.summaries, projectsDir, undefined, plansDir);

    expect(await search({ query: "platypus", type: "memories" })).toStrictEqual([
      {
        kind: "memory",
        id: memoryPath,
        title: "Test preferences",
        titleMatches: [],
        snippet: {
          text: "# Test preferences\n\nAlways feed the platypus.\n",
          matches: [{ start: 36, end: 44 }],
        },
        href: `/memory/${PROJECT}/feedback_tests`,
        projectId: PROJECT,
        projectName: "project",
        mtime: new Date(946_684_800_000).toISOString(),
      },
    ]);
  });

  it("filters documents by type and project", async () => {
    const planPath = join(plansDir, "rollout-plan.md");
    const memoryPath = join(memoryDir, "feedback_tests.md");
    writeDoc(planPath, "# Rollout plan\n\nFeed the platypus.\n", 946_684_800);
    writeDoc(memoryPath, "# Test preferences\n\nAlways feed the platypus.\n", 946_684_800);
    await fullScan(db.index, db.summaries, projectsDir, undefined, plansDir);

    const ids = async (parameters: Record<string, string>) =>
      (await search({ query: "platypus", ...parameters })).map((item) => item.id).sort();

    expect({
      all: await ids({}),
      plans: await ids({ type: "plans" }),
      memories: await ids({ type: "memories" }),
      sessions: await ids({ type: "sessions" }),
      project: await ids({ project: PROJECT }),
    }).toStrictEqual({
      all: [memoryPath, planPath].sort(),
      plans: [planPath],
      memories: [memoryPath],
      sessions: [],
      project: [memoryPath],
    });
  });

  it("editing and deleting a memory updates the index", async () => {
    const memoryPath = join(memoryDir, "feedback_tests.md");
    writeDoc(memoryPath, "# Test preferences\n\nAlways feed the platypus.\n", 946_684_800);
    await indexFile(db.index, memoryPath, projectsDir, plansDir);
    writeDoc(memoryPath, "# Test preferences\n\nAlways feed the wombat.\n", 946_684_900);
    await indexFile(db.index, memoryPath, projectsDir, plansDir);

    const afterEdit = {
      platypus: await search({ query: "platypus" }),
      wombat: (await search({ query: "wombat" })).map((item) => item.id),
    };

    rmSync(memoryPath);
    deleteMemoryFile(db.index, memoryPath);

    expect({
      afterEdit,
      afterDelete: { hits: await search({ query: "wombat" }), rows: docsRows() },
    }).toStrictEqual({
      afterEdit: { platypus: [], wombat: [memoryPath] },
      afterDelete: { hits: [], rows: [] },
    });
  });
});
