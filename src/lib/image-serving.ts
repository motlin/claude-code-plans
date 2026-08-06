import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, sep } from "node:path";
import { Readable } from "node:stream";
import { readConfig } from "./config";

const MAXIMUM_IMAGE_SIZE = 50 * 1024 * 1024;
const CACHE_CONTROL = "private, max-age=300";

const CONTENT_TYPES = new Map<string, string>([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

export async function handleImageRequest(request: Request, configPath?: string): Promise<Response> {
  const requestedPath = new URL(request.url).searchParams.get("path");
  if (requestedPath === null || !isAbsolute(requestedPath)) {
    return textResponse("An absolute image path is required", 400);
  }

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(requestedPath);
  } catch {
    return textResponse("Image not found", 404);
  }

  const configuredRoots = readConfig(configPath)?.image_roots ?? [];
  let resolvedRoots: string[];
  try {
    resolvedRoots = await Promise.all(configuredRoots.map((root) => realpath(root)));
  } catch {
    return textResponse("Image path is not allowed", 403);
  }

  const isContained = resolvedRoots.some(
    (root) => resolvedPath === root || resolvedPath.startsWith(root + sep),
  );
  if (!isContained) {
    return textResponse("Image path is not allowed", 403);
  }

  let imageStat: Awaited<ReturnType<typeof stat>>;
  try {
    imageStat = await stat(resolvedPath);
  } catch {
    return textResponse("Image not found", 404);
  }
  if (!imageStat.isFile()) {
    return textResponse("Image path is not a regular file", 403);
  }

  const contentType = CONTENT_TYPES.get(extname(resolvedPath).toLowerCase());
  if (contentType === undefined) {
    return textResponse("Image type is not supported", 415);
  }

  if (imageStat.size > MAXIMUM_IMAGE_SIZE) {
    return textResponse("Image exceeds the 50 MB size limit", 413);
  }

  const etag = `"${imageStat.mtimeMs}-${imageStat.size}"`;
  const cacheHeaders = {
    "Cache-Control": CACHE_CONTROL,
    ETag: etag,
  };
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }

  const body = Readable.toWeb(createReadStream(resolvedPath)) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      ...cacheHeaders,
      "Content-Length": imageStat.size.toString(),
      "Content-Type": contentType,
    },
  });
}
