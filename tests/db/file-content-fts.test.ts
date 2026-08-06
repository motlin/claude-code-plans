import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { resolveConfiguredFileRoots } from "../../src/lib/config";
import { openAppDb, openTestDb, type AppDb } from "../../src/lib/db/connection";
import {
  deleteFileContent,
  FILE_CONTENT_SIZE_CAP_BYTES,
  indexFileContent,
  scanFileContentRoots,
} from "../../src/lib/db/indexer";
import * as schema from "../../src/lib/db/schema";
import { __testing as watcherTesting } from "../../src/lib/watcher";

interface FileContentRow {
  path: string;
  content: string;
}

const EMPTY_IGNORED_DIR_NAMES = new Set<string>();

describe("file content FTS", () => {
  let fixtureDirectory: string;
  let allowedRoot: string;
  let db: AppDb;

  function rows(): FileContentRow[] {
    return db.index.all(
      sql`SELECT path, content FROM file_content_fts ORDER BY path`,
    ) as FileContentRow[];
  }

  function indexedPaths(): string[] {
    return db.index
      .select({ path: schema.indexedFiles.path })
      .from(schema.indexedFiles)
      .orderBy(schema.indexedFiles.path)
      .all()
      .map((row) => row.path);
  }

  function advanceMtime(filePath: string, milliseconds = 10_000): void {
    const nextTime = new Date(Date.now() + milliseconds);
    utimesSync(filePath, nextTime, nextTime);
  }

  beforeEach(() => {
    fixtureDirectory = mkdtempSync(join(tmpdir(), "file-content-fts-test-"));
    allowedRoot = join(fixtureDirectory, "allowed");
    mkdirSync(allowedRoot);
    allowedRoot = realpathSync(allowedRoot);
    db = openTestDb();
  });

  afterEach(() => {
    db.close();
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  it("creates the FTS table and finds a file by a term in its body", async () => {
    const filePath = join(allowedRoot, "alice.txt");
    writeFileSync(filePath, "A platypus appears in Alice's notes.\n");

    expect(await indexFileContent(db.index, filePath, [allowedRoot])).toStrictEqual({
      changed: true,
    });

    const matches = db.index.all(
      sql`SELECT path FROM file_content_fts WHERE file_content_fts MATCH ${"platypus"}`,
    );
    expect({ indexedPaths: indexedPaths(), matches, rows: rows() }).toStrictEqual({
      indexedPaths: [`file-content:${filePath}`],
      matches: [{ path: filePath }],
      rows: [{ path: filePath, content: "A platypus appears in Alice's notes.\n" }],
    });
  });

  it("replaces searchable content when a watched file changes", async () => {
    const filePath = join(allowedRoot, "alice.txt");
    writeFileSync(filePath, "The first token is zephyr.\n");
    await watcherTesting.handleFileContentChange(db.index, filePath, [allowedRoot]);

    writeFileSync(filePath, "The replacement token is quartz.\n");
    advanceMtime(filePath);
    await watcherTesting.handleFileContentChange(db.index, filePath, [allowedRoot]);

    expect({
      oldMatches: db.index.all(
        sql`SELECT path FROM file_content_fts WHERE file_content_fts MATCH ${"zephyr"}`,
      ),
      newMatches: db.index.all(
        sql`SELECT path FROM file_content_fts WHERE file_content_fts MATCH ${"quartz"}`,
      ),
      rows: rows(),
    }).toStrictEqual({
      oldMatches: [],
      newMatches: [{ path: filePath }],
      rows: [{ path: filePath, content: "The replacement token is quartz.\n" }],
    });
  });

  it("removes FTS and owned metadata rows when a watched file is deleted", async () => {
    const filePath = join(allowedRoot, "alice.txt");
    writeFileSync(filePath, "Delete this searchable text.\n");
    await indexFileContent(db.index, filePath, [allowedRoot]);
    rmSync(filePath);

    watcherTesting.handleFileContentUnlink(db.index, filePath);

    expect({ indexedPaths: indexedPaths(), rows: rows() }).toStrictEqual({
      indexedPaths: [],
      rows: [],
    });
  });

  it("skips binary files and removes a formerly indexed text file without touching another owner", async () => {
    const filePath = join(allowedRoot, "session-alice.jsonl");
    writeFileSync(filePath, "Searchable text before binary conversion.\n");
    db.index
      .insert(schema.indexedFiles)
      .values({ path: filePath, mtimeMs: 1000, sizeBytes: 100, indexedAt: 1000 })
      .run();
    await indexFileContent(db.index, filePath, [allowedRoot]);

    writeFileSync(filePath, Buffer.from([65, 0, 66]));
    advanceMtime(filePath);
    expect(await indexFileContent(db.index, filePath, [allowedRoot])).toStrictEqual({
      changed: true,
    });

    expect({ indexedPaths: indexedPaths(), rows: rows() }).toStrictEqual({
      indexedPaths: [filePath],
      rows: [],
    });
  });

  it("skips oversized files and indexes them after they shrink below the cap", async () => {
    const filePath = join(allowedRoot, "alice.txt");
    writeFileSync(filePath, Buffer.alloc(FILE_CONTENT_SIZE_CAP_BYTES + 1, 65));

    await indexFileContent(db.index, filePath, [allowedRoot]);
    expect({ indexedPaths: indexedPaths(), rows: rows() }).toStrictEqual({
      indexedPaths: [],
      rows: [],
    });

    writeFileSync(filePath, "Now Alice's file is small enough to index.\n");
    advanceMtime(filePath);
    await indexFileContent(db.index, filePath, [allowedRoot]);

    expect({ indexedPaths: indexedPaths(), rows: rows() }).toStrictEqual({
      indexedPaths: [`file-content:${filePath}`],
      rows: [{ path: filePath, content: "Now Alice's file is small enough to index.\n" }],
    });
  });

  it("performs no SQLite write when file metadata is unchanged", async () => {
    const filePath = join(allowedRoot, "alice.txt");
    writeFileSync(filePath, "Stable content for Alice.\n");
    await indexFileContent(db.index, filePath, [allowedRoot]);
    const before = db.index.get(sql`SELECT total_changes() AS changes`) as { changes: number };

    const result = await indexFileContent(db.index, filePath, [allowedRoot]);
    const after = db.index.get(sql`SELECT total_changes() AS changes`) as { changes: number };

    expect({ after, before, result }).toStrictEqual({
      after: before,
      before,
      result: { changed: false },
    });
  });

  it("initially discovers nested files while excluding ignored and outside directories", async () => {
    const nestedDirectory = join(allowedRoot, "nested");
    const ignoredDirectory = join(allowedRoot, "vendor");
    const outsideDirectory = join(fixtureDirectory, "outside");
    mkdirSync(nestedDirectory);
    mkdirSync(ignoredDirectory);
    mkdirSync(outsideDirectory);
    const nestedPath = join(nestedDirectory, "alice.ts");
    const ignoredPath = join(ignoredDirectory, "bob.ts");
    const outsidePath = join(outsideDirectory, "charlie.ts");
    writeFileSync(nestedPath, "export const alice = 'discoverable';\n");
    writeFileSync(ignoredPath, "export const bob = 'ignored';\n");
    writeFileSync(outsidePath, "export const charlie = 'outside';\n");

    expect(await indexFileContent(db.index, outsidePath, [allowedRoot])).toStrictEqual({
      changed: false,
    });
    await scanFileContentRoots(db.index, [allowedRoot], new Set(["vendor"]));

    expect(rows()).toStrictEqual([
      { path: nestedPath, content: "export const alice = 'discoverable';\n" },
    ]);
  });

  it("reconciles files removed while the watcher was stopped", async () => {
    const filePath = join(allowedRoot, "alice.txt");
    writeFileSync(filePath, "Present during the first startup scan.\n");
    await scanFileContentRoots(db.index, [allowedRoot], EMPTY_IGNORED_DIR_NAMES);
    rmSync(filePath);

    await scanFileContentRoots(db.index, [allowedRoot], EMPTY_IGNORED_DIR_NAMES);

    expect({ indexedPaths: indexedPaths(), rows: rows() }).toStrictEqual({
      indexedPaths: [],
      rows: [],
    });
  });

  it("does not follow a symlinked file outside an allowed root", async () => {
    const outsidePath = join(fixtureDirectory, "outside.txt");
    const symlinkPath = join(allowedRoot, "alice.txt");
    writeFileSync(outsidePath, "A secret outside the configured root.\n");
    symlinkSync(outsidePath, symlinkPath);

    expect(await indexFileContent(db.index, symlinkPath, [allowedRoot])).toStrictEqual({
      changed: false,
    });
    expect(rows()).toStrictEqual([]);
  });

  it("resolves the file_roots config key and removes overlapping nested roots", async () => {
    const nestedRoot = join(allowedRoot, "nested");
    mkdirSync(nestedRoot);
    const configPath = join(fixtureDirectory, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ image_roots: [allowedRoot], file_roots: [nestedRoot, allowedRoot] }),
    );

    expect(await resolveConfiguredFileRoots(configPath)).toStrictEqual([allowedRoot]);

    writeFileSync(configPath, JSON.stringify({ image_roots: [allowedRoot] }));
    expect(await resolveConfiguredFileRoots(configPath)).toStrictEqual([]);
  });

  it("drops and recreates file_content_fts on a schema-version mismatch", () => {
    const cacheDirectory = join(fixtureDirectory, "cache");
    const persistentDb = openAppDb({ cacheDir: cacheDirectory });
    persistentDb.index.run(
      sql`INSERT INTO file_content_fts(path, content) VALUES (${"/tmp/test/alice.txt"}, ${"old content"})`,
    );
    persistentDb.index
      .update(schema.metadata)
      .set({ value: "17" })
      .where(eq(schema.metadata.key, "schema_version"))
      .run();
    persistentDb.close();

    const rebuiltDb = openAppDb({ cacheDir: cacheDirectory });
    const table = rebuiltDb.index.get(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'file_content_fts'`,
    );
    const rebuiltRows = rebuiltDb.index.all(sql`SELECT path, content FROM file_content_fts`);
    const version = rebuiltDb.index
      .select({ value: schema.metadata.value })
      .from(schema.metadata)
      .where(eq(schema.metadata.key, "schema_version"))
      .get();
    rebuiltDb.close();

    expect({ rebuiltRows, table, version }).toStrictEqual({
      rebuiltRows: [],
      table: { name: "file_content_fts" },
      version: { value: "18" },
    });
  });

  it("supports direct exact-path deletion", async () => {
    const filePath = join(allowedRoot, "alice.txt");
    writeFileSync(filePath, "Delete Alice directly.\n");
    await indexFileContent(db.index, filePath, [allowedRoot]);

    deleteFileContent(db.index, filePath);

    expect({ indexedPaths: indexedPaths(), rows: rows() }).toStrictEqual({
      indexedPaths: [],
      rows: [],
    });
  });
});
