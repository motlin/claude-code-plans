import { openTestDb } from "../src/lib/db/connection.js";
import * as schema from "../src/lib/db/schema.js";
import { listProjectCommandSourcesFromDb } from "../src/lib/db/queries.js";

describe("listProjectCommandSourcesFromDb", () => {
  it("returns indexed projects that have a working directory", () => {
    const db = openTestDb();
    db.index
      .insert(schema.projects)
      .values([
        { id: "-b", name: "b", projectPath: "/work/b", updatedAt: 1 },
        { id: "-a", name: "a", projectPath: "/work/a", updatedAt: 2 },
        { id: "-none", name: "none", projectPath: null, updatedAt: 3 },
      ])
      .run();
    expect(listProjectCommandSourcesFromDb(db.index)).toEqual([
      { id: "-a", projectPath: "/work/a" },
      { id: "-b", projectPath: "/work/b" },
    ]);
  });
});
