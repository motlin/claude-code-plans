import type { Stats } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { resolveConfiguredFileRoots } from "./config";
import { FILE_CONTENT_SIZE_CAP_BYTES } from "./db/indexer";
import { fileTypeLabel } from "./file-preview";

const BINARY_SAMPLE_SIZE_BYTES = 512;

/** Why a readable file has no text preview, with what the viewer shows instead. */
export interface PreviewUnavailable {
  kind: "binary" | "too-large";
  size: number;
  type: string;
}

export class FileServingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly preview?: PreviewUnavailable,
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

export interface ReadTextOptions {
  /** Skip the binary sniff, for the viewer's "View as text anyway". */
  forceText?: boolean;
}

/** Read one allow-listed regular text file after resolving every filesystem boundary. */
export async function readAllowedFile(
  requestedPath: string,
  configPath?: string,
  defaultRoots: readonly string[] = [],
  options: ReadTextOptions = {},
): Promise<ServedFile> {
  return readResolvedTextFile(
    await resolveAllowedPath(requestedPath, configPath, defaultRoots),
    options,
  );
}

export interface AllowedFileStat {
  modifiedAtMilliseconds: number;
  path: string;
  sizeBytes: number;
}

/** Resolve and stat one allow-listed regular file without reading it, for streaming. */
export async function statAllowedFile(
  requestedPath: string,
  configPath?: string,
  defaultRoots: readonly string[] = [],
): Promise<AllowedFileStat> {
  const resolvedPath = await resolveAllowedPath(requestedPath, configPath, defaultRoots);
  const fileStat = await statRegularFile(resolvedPath);
  return {
    modifiedAtMilliseconds: fileStat.mtimeMs,
    path: resolvedPath,
    sizeBytes: fileStat.size,
  };
}

async function resolveAllowedPath(
  requestedPath: string,
  configPath: string | undefined,
  defaultRoots: readonly string[],
): Promise<string> {
  if (!isAbsolute(requestedPath)) {
    throw new FileServingError("An absolute file path is required", 400);
  }

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(requestedPath);
  } catch {
    throw new FileServingError("File not found", 404);
  }

  const roots = await resolveConfiguredFileRoots(configPath, defaultRoots);
  if (!roots.some((root) => isContainedPath(resolvedPath, root))) {
    throw new FileServingError("File path is not allowed", 403);
  }
  return resolvedPath;
}

/**
 * Read one regular text file named by a path relative to `root`. Absolute
 * paths and `..` segments are refused outright, and the fully resolved path
 * (after symlinks) must still sit inside the resolved root.
 */
export async function readFileUnderRoot(root: string, relativePath: string): Promise<ServedFile> {
  const segments = relativePath.split(/[/\\]/);
  if (
    relativePath === "" ||
    isAbsolute(relativePath) ||
    relativePath.includes("\0") ||
    segments.some((segment) => segment === "..")
  ) {
    throw new FileServingError("A relative path inside the root is required", 400);
  }

  let resolvedRoot: string;
  let resolvedPath: string;
  try {
    resolvedRoot = await realpath(root);
    resolvedPath = await realpath(join(resolvedRoot, relativePath));
  } catch {
    throw new FileServingError("File not found", 404);
  }
  if (!isContainedPath(resolvedPath, resolvedRoot)) {
    throw new FileServingError("File path is not allowed", 403);
  }

  return readResolvedTextFile(resolvedPath);
}

async function statRegularFile(resolvedPath: string): Promise<Stats> {
  let fileStat: Stats;
  try {
    fileStat = await stat(resolvedPath);
  } catch {
    throw new FileServingError("File not found", 404);
  }
  if (!fileStat.isFile()) {
    throw new FileServingError("File path is not a regular file", 403);
  }
  return fileStat;
}

function tooLarge(resolvedPath: string, size: number): FileServingError {
  return new FileServingError("File exceeds the 5 MiB size limit", 413, {
    kind: "too-large",
    size,
    type: fileTypeLabel(resolvedPath),
  });
}

async function readResolvedTextFile(
  resolvedPath: string,
  options: ReadTextOptions = {},
): Promise<ServedFile> {
  const fileStat = await statRegularFile(resolvedPath);
  if (fileStat.size > FILE_CONTENT_SIZE_CAP_BYTES) throw tooLarge(resolvedPath, fileStat.size);

  let contents: Buffer;
  try {
    contents = await readFile(resolvedPath);
  } catch {
    throw new FileServingError("File not found", 404);
  }
  if (contents.byteLength > FILE_CONTENT_SIZE_CAP_BYTES) {
    throw tooLarge(resolvedPath, contents.byteLength);
  }
  if (!options.forceText && contents.subarray(0, BINARY_SAMPLE_SIZE_BYTES).includes(0)) {
    throw new FileServingError("Binary files are not supported", 415, {
      kind: "binary",
      size: contents.byteLength,
      type: fileTypeLabel(resolvedPath),
    });
  }

  return {
    content: contents.toString("utf8"),
    modifiedAtMilliseconds: fileStat.mtimeMs,
    path: resolvedPath,
    sizeBytes: fileStat.size,
  };
}
