import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { resolveConfiguredFileRoots } from "./config";
import { FILE_CONTENT_SIZE_CAP_BYTES } from "./db/indexer";

const BINARY_SAMPLE_SIZE_BYTES = 512;

export class FileServingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FileServingError";
  }
}

export interface ServedFile {
  content: string;
  modifiedAtMilliseconds: number;
  path: string;
  sizeBytes: number;
}

function isContainedPath(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

/** Read one allow-listed regular text file after resolving every filesystem boundary. */
export async function readAllowedFile(
  requestedPath: string,
  configPath?: string,
): Promise<ServedFile> {
  if (!isAbsolute(requestedPath)) {
    throw new FileServingError("An absolute file path is required", 400);
  }

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(requestedPath);
  } catch {
    throw new FileServingError("File not found", 404);
  }

  const roots = await resolveConfiguredFileRoots(configPath);
  if (!roots.some((root) => isContainedPath(resolvedPath, root))) {
    throw new FileServingError("File path is not allowed", 403);
  }

  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(resolvedPath);
  } catch {
    throw new FileServingError("File not found", 404);
  }
  if (!fileStat.isFile()) {
    throw new FileServingError("File path is not a regular file", 403);
  }
  if (fileStat.size > FILE_CONTENT_SIZE_CAP_BYTES) {
    throw new FileServingError("File exceeds the 5 MiB size limit", 413);
  }

  let contents: Buffer;
  try {
    contents = await readFile(resolvedPath);
  } catch {
    throw new FileServingError("File not found", 404);
  }
  if (contents.byteLength > FILE_CONTENT_SIZE_CAP_BYTES) {
    throw new FileServingError("File exceeds the 5 MiB size limit", 413);
  }
  if (contents.subarray(0, BINARY_SAMPLE_SIZE_BYTES).includes(0)) {
    throw new FileServingError("Binary files are not supported", 415);
  }

  return {
    content: contents.toString("utf8"),
    modifiedAtMilliseconds: fileStat.mtimeMs,
    path: resolvedPath,
    sizeBytes: fileStat.size,
  };
}
