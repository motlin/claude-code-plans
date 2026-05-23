import { beforeEach, afterEach, describe, expect, it } from "vite-plus/test";
import { openTestDb, type AppDb } from "../../src/lib/db/connection";
import { getMemoriesForProject, getMemoryCountsForProjects } from "../../src/lib/db/queries";
import * as schema from "../../src/lib/db/schema";

let db: AppDb;

beforeEach(() => {
  db = openTestDb();
});

afterEach(() => {
  db.close();
});

function insertMemory(row: {
  filePath: string;
  projectId: string;
  filename: string;
  title: string;
  mtimeMs: number;
}): void {
  db.index.insert(schema.memories).values(row).run();
}

describe("getMemoryCountsForProjects", () => {
  it("returns an empty map when there are no memories", () => {
    const counts = getMemoryCountsForProjects(db.index);
    expect(counts.size).toBe(0);
  });

  it("returns per-project counts grouped by project_id", () => {
    insertMemory({
      filePath: "/p/a/memory/1.md",
      projectId: "proj-a",
      filename: "1.md",
      title: "A1",
      mtimeMs: 1,
    });
    insertMemory({
      filePath: "/p/a/memory/2.md",
      projectId: "proj-a",
      filename: "2.md",
      title: "A2",
      mtimeMs: 2,
    });
    insertMemory({
      filePath: "/p/a/memory/3.md",
      projectId: "proj-a",
      filename: "3.md",
      title: "A3",
      mtimeMs: 3,
    });
    insertMemory({
      filePath: "/p/b/memory/1.md",
      projectId: "proj-b",
      filename: "1.md",
      title: "B1",
      mtimeMs: 4,
    });

    const counts = getMemoryCountsForProjects(db.index);
    expect(counts.size).toBe(2);
    expect(counts.get("proj-a")).toBe(3);
    expect(counts.get("proj-b")).toBe(1);
    expect(counts.get("proj-c")).toBeUndefined();
  });
});

describe("getMemoriesForProject", () => {
  it("returns rows for the requested project ordered by mtime_ms desc", () => {
    insertMemory({
      filePath: "/p/a/memory/old.md",
      projectId: "proj-a",
      filename: "old.md",
      title: "Old",
      mtimeMs: 100,
    });
    insertMemory({
      filePath: "/p/a/memory/new.md",
      projectId: "proj-a",
      filename: "new.md",
      title: "New",
      mtimeMs: 300,
    });
    insertMemory({
      filePath: "/p/a/memory/mid.md",
      projectId: "proj-a",
      filename: "mid.md",
      title: "Mid",
      mtimeMs: 200,
    });
    insertMemory({
      filePath: "/p/b/memory/x.md",
      projectId: "proj-b",
      filename: "x.md",
      title: "X",
      mtimeMs: 500,
    });

    const rows = getMemoriesForProject(db.index, "proj-a");
    expect(rows).toStrictEqual([
      { filename: "new.md", title: "New", mtimeMs: 300 },
      { filename: "mid.md", title: "Mid", mtimeMs: 200 },
      { filename: "old.md", title: "Old", mtimeMs: 100 },
    ]);
  });

  it("returns an empty array when the project has no memories", () => {
    insertMemory({
      filePath: "/p/b/memory/x.md",
      projectId: "proj-b",
      filename: "x.md",
      title: "X",
      mtimeMs: 1,
    });

    const rows = getMemoriesForProject(db.index, "proj-a");
    expect(rows).toStrictEqual([]);
  });
});
