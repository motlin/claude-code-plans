import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleImageRequest } from "../src/lib/image-serving";

const MAXIMUM_IMAGE_SIZE = 50 * 1024 * 1024;

let fixtureDirectory: string;
let allowedRoot: string;
let configPath: string;

function writeConfig(imageRoots: string[]): void {
  writeFileSync(configPath, JSON.stringify({ image_roots: imageRoots }));
}

function imageRequest(path?: string, headers?: HeadersInit): Request {
  const url = new URL("http://127.0.0.1:7526/api/image");
  if (path !== undefined) url.searchParams.set("path", path);
  return new Request(url, headers === undefined ? undefined : { headers });
}

async function describeResponse(response: Response): Promise<{
  body: string;
  headers: Record<string, string>;
  status: number;
}> {
  return {
    body: await response.text(),
    headers: Object.fromEntries(response.headers),
    status: response.status,
  };
}

beforeEach(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "api-image-test-"));
  allowedRoot = join(fixtureDirectory, "allowed");
  configPath = join(fixtureDirectory, "config.json");
  mkdirSync(allowedRoot);
  writeConfig([allowedRoot]);
});

afterEach(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true });
});

describe("image byte serving", () => {
  it("streams an image inside an allow-listed root with private cache metadata", async () => {
    const imagePath = join(allowedRoot, "alice.png");
    writeFileSync(imagePath, "fabricated png bytes");
    const imageStat = await stat(imagePath);

    const response = await handleImageRequest(imageRequest(imagePath), configPath);

    expect(await describeResponse(response)).toStrictEqual({
      body: "fabricated png bytes",
      headers: {
        "cache-control": "private, max-age=300",
        "content-length": "20",
        "content-type": "image/png",
        etag: `"${imageStat.mtimeMs}-20"`,
      },
      status: 200,
    });
  });

  it("returns 304 with the same cache metadata when If-None-Match matches", async () => {
    const imagePath = join(allowedRoot, "alice.jpg");
    writeFileSync(imagePath, "fabricated jpeg bytes");
    const imageStat = await stat(imagePath);
    const etag = `"${imageStat.mtimeMs}-${imageStat.size}"`;

    const response = await handleImageRequest(
      imageRequest(imagePath, { "If-None-Match": etag }),
      configPath,
    );

    expect(await describeResponse(response)).toStrictEqual({
      body: "",
      headers: {
        "cache-control": "private, max-age=300",
        etag,
      },
      status: 304,
    });
  });

  it("derives content types from every allow-listed extension without case sensitivity", async () => {
    const cases = [
      { extension: ".gif", contentType: "image/gif" },
      { extension: ".JPEG", contentType: "image/jpeg" },
      { extension: ".jpg", contentType: "image/jpeg" },
      { extension: ".PNG", contentType: "image/png" },
      { extension: ".webp", contentType: "image/webp" },
    ];

    const results = await Promise.all(
      cases.map(async ({ extension }) => {
        const imagePath = join(allowedRoot, `alice${extension}`);
        writeFileSync(imagePath, "image");
        const response = await handleImageRequest(imageRequest(imagePath), configPath);
        await response.body?.cancel();
        return {
          contentType: response.headers.get("Content-Type"),
          status: response.status,
        };
      }),
    );

    expect(results).toStrictEqual(cases.map(({ contentType }) => ({ contentType, status: 200 })));
  });

  it("allows an image exactly at the 50 MB boundary", async () => {
    const imagePath = join(allowedRoot, "boundary.webp");
    writeFileSync(imagePath, "");
    truncateSync(imagePath, MAXIMUM_IMAGE_SIZE);

    const response = await handleImageRequest(imageRequest(imagePath), configPath);
    await response.body?.cancel();

    expect({
      contentLength: response.headers.get("Content-Length"),
      status: response.status,
    }).toStrictEqual({
      contentLength: MAXIMUM_IMAGE_SIZE.toString(),
      status: 200,
    });
  });

  it("rejects an image above the 50 MB boundary", async () => {
    const imagePath = join(allowedRoot, "too-large.gif");
    writeFileSync(imagePath, "");
    truncateSync(imagePath, MAXIMUM_IMAGE_SIZE + 1);

    const response = await handleImageRequest(imageRequest(imagePath), configPath);

    expect(await describeResponse(response)).toStrictEqual({
      body: "Image exceeds the 50 MB size limit",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      status: 413,
    });
  });
});

describe("image path containment", () => {
  it.each([
    { path: undefined, name: "a missing path" },
    { path: "alice.png", name: "a relative path" },
  ])("rejects $name", async ({ path }) => {
    const response = await handleImageRequest(imageRequest(path), configPath);

    expect(await describeResponse(response)).toStrictEqual({
      body: "An absolute image path is required",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      status: 400,
    });
  });

  it("returns 404 for a nonexistent file", async () => {
    const response = await handleImageRequest(
      imageRequest(join(allowedRoot, "missing.png")),
      configPath,
    );

    expect(await describeResponse(response)).toStrictEqual({
      body: "Image not found",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      status: 404,
    });
  });

  it("fails closed when a configured root does not exist", async () => {
    const imagePath = join(allowedRoot, "alice.png");
    writeFileSync(imagePath, "image");
    writeConfig([allowedRoot, join(fixtureDirectory, "missing-root")]);

    const response = await handleImageRequest(imageRequest(imagePath), configPath);

    expect(await describeResponse(response)).toStrictEqual({
      body: "Image path is not allowed",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      status: 403,
    });
  });

  it("rejects a file outside every configured root before checking its extension", async () => {
    const outsidePath = join(fixtureDirectory, "outside.txt");
    writeFileSync(outsidePath, "outside bytes");

    const response = await handleImageRequest(imageRequest(outsidePath), configPath);

    expect(await describeResponse(response)).toStrictEqual({
      body: "Image path is not allowed",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      status: 403,
    });
  });

  it("rejects a symlink inside a root when its real target is outside", async () => {
    const outsidePath = join(fixtureDirectory, "outside.png");
    const symlinkPath = join(allowedRoot, "alice.png");
    writeFileSync(outsidePath, "outside bytes");
    symlinkSync(outsidePath, symlinkPath);

    const response = await handleImageRequest(imageRequest(symlinkPath), configPath);

    expect(await describeResponse(response)).toStrictEqual({
      body: "Image path is not allowed",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      status: 403,
    });
  });

  it("rejects a directory as a non-regular file", async () => {
    const directoryPath = join(allowedRoot, "alice.png");
    mkdirSync(directoryPath);

    const response = await handleImageRequest(imageRequest(directoryPath), configPath);

    expect(await describeResponse(response)).toStrictEqual({
      body: "Image path is not a regular file",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      status: 403,
    });
  });

  it("rejects a file with an extension outside the allow-list", async () => {
    const textPath = join(allowedRoot, "alice.txt");
    writeFileSync(textPath, "text bytes");

    const response = await handleImageRequest(imageRequest(textPath), configPath);

    expect(await describeResponse(response)).toStrictEqual({
      body: "Image type is not supported",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      status: 415,
    });
  });

  it("allows dot-dot segments when realpath resolves them inside the root", async () => {
    const imagePath = join(allowedRoot, "alice.png");
    const nestedDirectory = join(allowedRoot, "nested");
    mkdirSync(nestedDirectory);
    writeFileSync(imagePath, "inside bytes");
    const imageStat = await stat(imagePath);

    const response = await handleImageRequest(
      imageRequest(join(nestedDirectory, "..", "alice.png")),
      configPath,
    );

    expect(await describeResponse(response)).toStrictEqual({
      body: "inside bytes",
      headers: {
        "cache-control": "private, max-age=300",
        "content-length": "12",
        "content-type": "image/png",
        etag: `"${imageStat.mtimeMs}-12"`,
      },
      status: 200,
    });
  });
});
