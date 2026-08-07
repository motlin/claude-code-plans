import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  decodeFilePath,
  encodeFilePath,
  fileViewerPath,
  FileViewerResponse,
} from "../src/lib/api/file";
import { FILE_CONTENT_SIZE_CAP_BYTES } from "../src/lib/db/indexer";
import { handleFileRequest } from "../src/routes/api/file.$";

let fixtureDirectory: string;
let allowedRoot: string;
let outsideRoot: string;
let configPath: string;

function writeConfig(fileRoots: string[]): void {
  writeFileSync(configPath, JSON.stringify({ file_roots: fileRoots }));
}

function fileRequest(path: string, headers?: HeadersInit): Request {
  const token = encodeFilePath(path);
  return new Request(
    `http://127.0.0.1:7526/api/file/${token}`,
    headers === undefined ? undefined : { headers },
  );
}

async function describeJsonResponse(response: Response): Promise<{
  body: unknown;
  cacheControl: string | null;
  etag: string | null;
  status: number;
}> {
  return {
    body: await response.json(),
    cacheControl: response.headers.get("Cache-Control"),
    etag: response.headers.get("ETag"),
    status: response.status,
  };
}

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".llm"), { recursive: true });
  fixtureDirectory = mkdtempSync(join(process.cwd(), ".llm", "api-file-test-"));
  allowedRoot = join(fixtureDirectory, "allowed");
  outsideRoot = join(fixtureDirectory, "outside");
  configPath = join(fixtureDirectory, "config.json");
  mkdirSync(allowedRoot);
  mkdirSync(outsideRoot);
  allowedRoot = realpathSync(allowedRoot);
  outsideRoot = realpathSync(outsideRoot);
  writeConfig([allowedRoot]);
});

afterEach(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true });
});

describe("file viewer API", () => {
  it("returns a validated allow-listed text file with private revalidation metadata", async () => {
    const filePath = join(allowedRoot, "alice.ts");
    writeFileSync(filePath, "export const answer = 100;\n");
    const fileStat = statSync(filePath);

    const response = await handleFileRequest(
      fileRequest(filePath),
      encodeFilePath(filePath),
      configPath,
    );
    const described = await describeJsonResponse(response);

    expect({
      ...described,
      schemaResult: FileViewerResponse.safeParse(described.body).success,
    }).toStrictEqual({
      body: {
        content: "export const answer = 100;\n",
        path: realpathSync(filePath),
      },
      cacheControl: "private, max-age=0, must-revalidate",
      etag: `"${fileStat.mtimeMs}-${fileStat.size}"`,
      schemaResult: true,
      status: 200,
    });
  });

  it("opens a file under a default project root when file_roots is unset", async () => {
    writeFileSync(configPath, JSON.stringify({}));
    const filePath = join(allowedRoot, "indexer.ts");
    writeFileSync(filePath, "export const indexer = 'available';\n");

    const response = await handleFileRequest(
      fileRequest(filePath),
      encodeFilePath(filePath),
      configPath,
      [allowedRoot],
    );

    expect({ body: await response.json(), status: response.status }).toStrictEqual({
      body: {
        content: "export const indexer = 'available';\n",
        path: realpathSync(filePath),
      },
      status: 200,
    });
  });

  it("round-trips spaces and Unicode through one opaque splat segment", async () => {
    const filePath = join(allowedRoot, "alice notes-你好.ts");
    writeFileSync(filePath, "const greeting = 'hello';\n");
    const token = encodeFilePath(filePath);
    const response = await handleFileRequest(fileRequest(filePath), token, configPath);
    const body: unknown = await response.json();

    expect({
      token,
      tokenHasOnlyRouteSafeCharacters: /^[A-Za-z0-9_-]+$/.test(token),
      decodedPath: decodeFilePath(token),
      routePath: fileViewerPath(filePath),
      response: { body, status: response.status },
    }).toStrictEqual({
      token,
      tokenHasOnlyRouteSafeCharacters: true,
      decodedPath: filePath,
      routePath: `/file/${token}`,
      response: {
        body: { content: "const greeting = 'hello';\n", path: realpathSync(filePath) },
        status: 200,
      },
    });
  });

  it("returns 304 with matching private cache metadata", async () => {
    const filePath = join(allowedRoot, "alice.txt");
    writeFileSync(filePath, "fabricated text\n");
    const fileStat = statSync(filePath);
    const etag = `"${fileStat.mtimeMs}-${fileStat.size}"`;

    const response = await handleFileRequest(
      fileRequest(filePath, { "If-None-Match": etag }),
      encodeFilePath(filePath),
      configPath,
    );

    expect({
      body: await response.text(),
      headers: Object.fromEntries(response.headers),
      status: response.status,
    }).toStrictEqual({
      body: "",
      headers: {
        "cache-control": "private, max-age=0, must-revalidate",
        etag,
      },
      status: 304,
    });
  });

  it("rejects outside files and symlinks that escape after realpath resolution", async () => {
    const outsidePath = join(outsideRoot, "bob.txt");
    const symlinkPath = join(allowedRoot, "bob-link.txt");
    writeFileSync(outsidePath, "outside content\n");
    symlinkSync(outsidePath, symlinkPath);

    const responses = await Promise.all(
      [outsidePath, symlinkPath].map((path) =>
        handleFileRequest(fileRequest(path), encodeFilePath(path), configPath),
      ),
    );

    expect(await Promise.all(responses.map(describeJsonResponse))).toStrictEqual(
      Array.from({ length: 2 }, () => ({
        body: { error: "File path is not allowed" },
        cacheControl: "private, max-age=0, must-revalidate",
        etag: null,
        status: 403,
      })),
    );
  });

  it("returns deliberate statuses for directories, binary files, oversized files, and missing files", async () => {
    const directoryPath = join(allowedRoot, "alice-directory");
    const binaryPath = join(allowedRoot, "alice.bin");
    const oversizedPath = join(allowedRoot, "alice-large.txt");
    const missingPath = join(allowedRoot, "alice-missing.txt");
    mkdirSync(directoryPath);
    writeFileSync(binaryPath, Buffer.from([65, 0, 66]));
    writeFileSync(oversizedPath, "");
    truncateSync(oversizedPath, FILE_CONTENT_SIZE_CAP_BYTES + 1);

    const responses = await Promise.all(
      [directoryPath, binaryPath, oversizedPath, missingPath].map((path) =>
        handleFileRequest(fileRequest(path), encodeFilePath(path), configPath),
      ),
    );

    expect(await Promise.all(responses.map(describeJsonResponse))).toStrictEqual([
      {
        body: { error: "File path is not a regular file" },
        cacheControl: "private, max-age=0, must-revalidate",
        etag: null,
        status: 403,
      },
      {
        body: { error: "Binary files are not supported" },
        cacheControl: "private, max-age=0, must-revalidate",
        etag: null,
        status: 415,
      },
      {
        body: { error: "File exceeds the 5 MiB size limit" },
        cacheControl: "private, max-age=0, must-revalidate",
        etag: null,
        status: 413,
      },
      {
        body: { error: "File not found" },
        cacheControl: "private, max-age=0, must-revalidate",
        etag: null,
        status: 404,
      },
    ]);
  });

  it("rejects relative paths and malformed path tokens without exposing a raw-path endpoint", async () => {
    const relativeToken = encodeFilePath("alice.txt");
    const responses = await Promise.all([
      handleFileRequest(fileRequest("alice.txt"), relativeToken, configPath),
      handleFileRequest(
        new Request("http://127.0.0.1:7526/api/file/not-valid"),
        "../alice",
        configPath,
      ),
      handleFileRequest(new Request("http://127.0.0.1:7526/api/file/empty"), "", configPath),
    ]);

    expect(await Promise.all(responses.map(describeJsonResponse))).toStrictEqual([
      {
        body: { error: "An absolute file path is required" },
        cacheControl: "private, max-age=0, must-revalidate",
        etag: null,
        status: 400,
      },
      {
        body: { error: "A valid encoded file path is required" },
        cacheControl: "private, max-age=0, must-revalidate",
        etag: null,
        status: 400,
      },
      {
        body: { error: "A valid encoded file path is required" },
        cacheControl: "private, max-age=0, must-revalidate",
        etag: null,
        status: 400,
      },
    ]);
  });
});
