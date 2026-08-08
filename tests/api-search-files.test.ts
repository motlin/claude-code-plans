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
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { resolveFileSearchRoots, resolveFileSearchScope } from "../src/lib/config";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import { indexFileContent } from "../src/lib/db/indexer";
import { searchFileContentDb } from "../src/lib/db/queries";
import * as schema from "../src/lib/db/schema";
import { handleFileSearchRequest } from "../src/routes/api/search.files";

const FIRST_TEST_TIME = new Date("2000-01-01T00:00:00.000Z");
const SECOND_TEST_TIME = new Date("2000-01-02T00:00:00.000Z");

describe("file content search API", () => {
  let fixtureDirectory: string;
  let allowedRoot: string;
  let outsideRoot: string;
  let configPath: string;
  let db: AppDb;

  async function seedFile(
    relativePath: string,
    content: string,
    modifiedAt: Date = FIRST_TEST_TIME,
  ): Promise<string> {
    const filePath = join(allowedRoot, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
    utimesSync(filePath, modifiedAt, modifiedAt);
    await indexFileContent(db.index, filePath, [allowedRoot]);
    return realpathSync(filePath);
  }

  function request(parameters: Record<string, string | undefined>): Request {
    const url = new URL("http://127.0.0.1:7526/api/search/files");
    for (const [name, value] of Object.entries(parameters)) {
      if (value !== undefined) url.searchParams.set(name, value);
    }
    return new Request(url);
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
    fixtureDirectory = mkdtempSync(join(tmpdir(), "api-search-files-test-"));
    allowedRoot = join(fixtureDirectory, "allowed");
    outsideRoot = join(fixtureDirectory, "outside");
    configPath = join(fixtureDirectory, "config.json");
    mkdirSync(allowedRoot);
    mkdirSync(join(allowedRoot, ".git"));
    mkdirSync(outsideRoot);
    allowedRoot = realpathSync(allowedRoot);
    outsideRoot = realpathSync(outsideRoot);
    writeFileSync(configPath, JSON.stringify({ file_roots: [allowedRoot] }));
    db = openTestDb();
  });

  afterEach(() => {
    db.close();
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  it("ranks basename matches above directory and body-only matches", async () => {
    const filenamePath = await seedFile("needle-notes.txt", "Filename-only candidate.\n");
    const directoryPath = await seedFile("needle-folder/alice.txt", "Directory-only candidate.\n");
    const bodyPath = await seedFile("bob.txt", `${"needle ".repeat(200)}\n`);

    const result = searchFileContentDb(db.index, "needle", allowedRoot);
    const ranks = result.files.map((file) => file.rank);

    expect(ranks[0]! < ranks[1]! && ranks[1]! < ranks[2]!).toBe(true);
    expect({
      ...result,
      files: result.files.map(({ rank: _rank, ...file }) => file),
    }).toStrictEqual({
      files: [
        {
          path: filenamePath,
          matchCount: 0,
          matches: [],
          mtime: FIRST_TEST_TIME.toISOString(),
        },
        {
          path: directoryPath,
          matchCount: 0,
          matches: [],
          mtime: FIRST_TEST_TIME.toISOString(),
        },
        {
          path: bodyPath,
          matchCount: 1,
          matches: [
            { lineNumber: 1, snippet: `${"<mark>needle</mark> ".repeat(48).trimEnd()}...` },
          ],
          mtime: FIRST_TEST_TIME.toISOString(),
        },
      ],
      totalResults: 1,
      totalFiles: 3,
      isTruncated: false,
    });
  });

  it("returns correct line numbers and escapes source HTML around intended highlights", async () => {
    const filePath = await seedFile(
      "alice.txt",
      "first line\nneedle <img src=x onerror=alert(1)>\nthird line\nanother needle\n",
    );

    const result = searchFileContentDb(db.index, "needle", allowedRoot);
    const resultFile = result.files[0];
    if (!resultFile) throw new Error("Expected a fabricated file search result");
    const { rank: _rank, ...file } = resultFile;

    expect({ ...result, files: [file] }).toStrictEqual({
      files: [
        {
          path: filePath,
          matchCount: 2,
          matches: [
            {
              lineNumber: 2,
              snippet: "<mark>needle</mark> &lt;img src=x onerror=alert(1)&gt;",
            },
            { lineNumber: 4, snippet: "another <mark>needle</mark>" },
          ],
          mtime: FIRST_TEST_TIME.toISOString(),
        },
      ],
      totalResults: 2,
      totalFiles: 1,
      isTruncated: false,
    });
  });

  it("caps matches per file while reporting honest totals", async () => {
    const filePath = await seedFile(
      "alice.txt",
      Array.from({ length: 60 }, (_, index) => `line ${index + 1} needle`).join("\n"),
    );

    const result = searchFileContentDb(db.index, "needle", allowedRoot);
    const file = result.files[0]!;

    expect({
      path: file.path,
      matchCount: file.matchCount,
      returnedMatches: file.matches.length,
      firstMatch: file.matches[0],
      lastMatch: file.matches.at(-1),
      totals: {
        totalResults: result.totalResults,
        totalFiles: result.totalFiles,
        isTruncated: result.isTruncated,
      },
    }).toStrictEqual({
      path: filePath,
      matchCount: 60,
      returnedMatches: 50,
      firstMatch: { lineNumber: 1, snippet: "line 1 <mark>needle</mark>" },
      lastMatch: { lineNumber: 50, snippet: "line 50 <mark>needle</mark>" },
      totals: { totalResults: 60, totalFiles: 1, isTruncated: true },
    });
  });

  it("caps files after computing honest totals", async () => {
    await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        seedFile(`alice-${String(index).padStart(3, "0")}.txt`, "needle\n"),
      ),
    );

    const result = searchFileContentDb(db.index, "needle", allowedRoot);

    expect({
      returnedFiles: result.files.length,
      firstPath: result.files[0]!.path,
      lastPath: result.files.at(-1)!.path,
      totalResults: result.totalResults,
      totalFiles: result.totalFiles,
      isTruncated: result.isTruncated,
    }).toStrictEqual({
      returnedFiles: 100,
      firstPath: join(allowedRoot, "alice-000.txt"),
      lastPath: join(allowedRoot, "alice-099.txt"),
      totalResults: 101,
      totalFiles: 101,
      isTruncated: true,
    });
  });

  it("uses mtime descending and then path as equal-rank tie breaks", async () => {
    const bobPath = await seedFile("bob.txt", "needle\n");
    const alicePath = await seedFile("alice.txt", "needle\n");
    const charliePath = await seedFile("charlie.txt", "needle\n", SECOND_TEST_TIME);

    const result = searchFileContentDb(db.index, "needle", allowedRoot);

    expect(result.files.map(({ path, mtime }) => ({ path, mtime }))).toStrictEqual([
      { path: charliePath, mtime: SECOND_TEST_TIME.toISOString() },
      { path: alicePath, mtime: FIRST_TEST_TIME.toISOString() },
      { path: bobPath, mtime: FIRST_TEST_TIME.toISOString() },
    ]);
  });

  it("quotes user input as literal FTS terms and returns empty results for punctuation only", async () => {
    const filePath = await seedFile("alice.txt", "needle or test syntax\n");

    const escapedQuery = searchFileContentDb(db.index, 'needle" OR (test)*', allowedRoot);
    const punctuationQuery = searchFileContentDb(db.index, '" + () *', allowedRoot);

    expect({
      escapedPaths: escapedQuery.files.map((file) => file.path),
      punctuationQuery,
    }).toStrictEqual({
      escapedPaths: [filePath],
      punctuationQuery: { files: [], totalResults: 0, totalFiles: 0, isTruncated: false },
    });
  });

  it("returns an exact empty response when no indexed content matches", async () => {
    await seedFile("alice.txt", "fabricated searchable content\n");

    expect(searchFileContentDb(db.index, "missing", allowedRoot)).toStrictEqual({
      files: [],
      totalResults: 0,
      totalFiles: 0,
      isTruncated: false,
    });
  });

  it("realpaths requested scopes and configured roots before containment", async () => {
    const nestedRoot = join(allowedRoot, "nested");
    const outsideSymlink = join(allowedRoot, "outside-link");
    const missingRoot = join(allowedRoot, "missing");
    const regularFile = join(allowedRoot, "alice.txt");
    mkdirSync(nestedRoot);
    writeFileSync(regularFile, "test file");
    symlinkSync(outsideRoot, outsideSymlink);

    expect(
      await Promise.all([
        resolveFileSearchScope(nestedRoot, configPath),
        resolveFileSearchScope(outsideRoot, configPath),
        resolveFileSearchScope(outsideSymlink, configPath),
        resolveFileSearchScope(missingRoot, configPath),
        resolveFileSearchScope(regularFile, configPath),
      ]),
    ).toStrictEqual([realpathSync(nestedRoot), null, null, null, null]);
  });

  it("rejects missing parameters without invoking scope or database dependencies", async () => {
    const resolveScope = vi.fn<(scopeRoot: string) => Promise<string | null>>();
    const search =
      vi.fn<(query: string, scopeRoot: string) => ReturnType<typeof searchFileContentDb>>();

    const responses = await Promise.all([
      handleFileSearchRequest(request({ query: undefined, scopeRoot: allowedRoot }), {
        resolveScope,
        search,
      }),
      handleFileSearchRequest(request({ query: "needle", scopeRoot: undefined }), {
        resolveScope,
        search,
      }),
      handleFileSearchRequest(request({ query: "  ", scopeRoot: allowedRoot }), {
        resolveScope,
        search,
      }),
    ]);

    expect({
      responses: await Promise.all(responses.map(describeResponse)),
      resolveCalls: resolveScope.mock.calls,
      searchCalls: search.mock.calls,
    }).toStrictEqual({
      responses: Array.from({ length: 3 }, () => ({
        body: { error: "query and scopeRoot are required" },
        cacheControl: "private, max-age=0, must-revalidate",
        status: 400,
      })),
      resolveCalls: [],
      searchCalls: [],
    });
  });

  it("returns the validated route contract with private no-cache metadata", async () => {
    const filePath = await seedFile("alice.txt", "needle\n");
    const response = await handleFileSearchRequest(
      request({ query: " needle ", scopeRoot: allowedRoot }),
      {
        resolveScope: (scopeRoot) => resolveFileSearchScope(scopeRoot, configPath),
        search: (query, scopeRoot) => searchFileContentDb(db.index, query, scopeRoot),
      },
    );
    const described = await describeResponse(response);
    const body = described.body as { files: Array<{ rank: number }> };
    const resultFile = body.files[0];
    if (!resultFile) throw new Error("Expected a fabricated route result");
    const { rank: _rank, ...file } = resultFile;

    expect({
      ...described,
      body: { ...(described.body as object), files: [file] },
    }).toStrictEqual({
      body: {
        files: [
          {
            path: filePath,
            matchCount: 1,
            matches: [{ lineNumber: 1, snippet: "<mark>needle</mark>" }],
            mtime: FIRST_TEST_TIME.toISOString(),
          },
        ],
        totalResults: 1,
        totalFiles: 1,
        isTruncated: false,
      },
      cacheControl: "private, max-age=0, must-revalidate",
      status: 200,
    });
  });

  it("searches an indexed project with no file_roots configuration", async () => {
    writeFileSync(configPath, JSON.stringify({}));
    db.index
      .insert(schema.projects)
      .values({ id: "allowed", name: "Allowed", projectPath: allowedRoot, updatedAt: 1_000 })
      .run();
    const roots = await resolveFileSearchRoots(db.index, configPath);
    const filePath = join(allowedRoot, "indexer.ts");
    writeFileSync(filePath, "export const indexer = 'available';\n");
    await indexFileContent(db.index, filePath, roots);

    const response = await handleFileSearchRequest(
      request({ query: "indexer", scopeRoot: allowedRoot }),
      {
        resolveScope: (scopeRoot) => resolveFileSearchScope(scopeRoot, configPath, roots),
        search: (query, scopeRoot) => searchFileContentDb(db.index, query, scopeRoot),
      },
    );
    const body = (await response.json()) as { files: Array<{ path: string }> };

    expect({
      paths: body.files.map((file) => file.path),
      roots,
      status: response.status,
    }).toStrictEqual({
      paths: [realpathSync(filePath)],
      roots: [allowedRoot],
      status: 200,
    });
  });

  it("rejects disallowed scopes with private no-cache metadata", async () => {
    const search =
      vi.fn<(query: string, scopeRoot: string) => ReturnType<typeof searchFileContentDb>>();
    const response = await handleFileSearchRequest(
      request({ query: "needle", scopeRoot: outsideRoot }),
      {
        resolveScope: (scopeRoot) => resolveFileSearchScope(scopeRoot, configPath),
        search,
      },
    );

    expect({
      response: await describeResponse(response),
      searchCalls: search.mock.calls,
    }).toStrictEqual({
      response: {
        body: { error: "scopeRoot is not an allowed directory" },
        cacheControl: "private, max-age=0, must-revalidate",
        status: 403,
      },
      searchCalls: [],
    });
  });

  it("fails response validation rather than serving a malformed database result", async () => {
    const malformedSearch = () => ({
      files: [{ path: join(allowedRoot, "alice.txt"), matches: [{}] }],
      totalResults: 1,
      totalFiles: 1,
      isTruncated: false,
    });

    await expect(
      handleFileSearchRequest(request({ query: "needle", scopeRoot: allowedRoot }), {
        resolveScope: async () => allowedRoot,
        // @ts-expect-error Deliberately malformed to verify the runtime contract.
        search: malformedSearch,
      }),
    ).rejects.toThrow();
  });
});
