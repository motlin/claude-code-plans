import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { realpath, stat } from "node:fs/promises";
import {
  SessionFilesErrorResponseSchema,
  SessionFilesResponseSchema,
  type SessionFilesResponse,
} from "./api/session-files";
import { resolveConfiguredFileRoots, resolveFileSearchRoots } from "./config";
import { getDb } from "./db";
import * as schema from "./db/schema";
import {
  fuzzyFilePaths,
  gitCheckIgnored,
  isContainedPath,
  listDir,
  walkWorkspace,
  WorkspacePathError,
  type IgnoreCheck,
} from "./workspace-files";

type IndexDb = BetterSQLite3Database<typeof schema>;

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

export interface SessionFilesHandlerDependencies {
  index: IndexDb;
  /** Real directories a working directory must sit inside (the `file_roots` allowlist). */
  allowedRoots(): Promise<string[]>;
  checkIgnored: IgnoreCheck;
}

function defaultDependencies(): SessionFilesHandlerDependencies {
  const index = getDb().index;
  return {
    index,
    allowedRoots: async () =>
      resolveConfiguredFileRoots(undefined, await resolveFileSearchRoots(index)),
    checkIgnored: gitCheckIgnored,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": PRIVATE_NO_CACHE } });
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse(SessionFilesErrorResponseSchema.parse({ error }), status);
}

function filesResponse(body: SessionFilesResponse): Response {
  return jsonResponse(SessionFilesResponseSchema.parse(body));
}

async function resolveDirectory(cwd: string): Promise<string | null> {
  try {
    const resolved = await realpath(cwd);
    return (await stat(resolved)).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * `GET /api/sessions/$id/files?dir=<rel>&q=<query>&hideIgnored=1`: list one
 * directory of the session's working directory, or fuzzy-search every path
 * under `dir` when `q` is set.
 */
export async function handleSessionFilesRequest(
  sessionId: string,
  parameters: URLSearchParams,
  dependencies?: SessionFilesHandlerDependencies,
): Promise<Response> {
  if (!sessionId) return errorResponse("A session id is required", 400);
  const hideIgnoredFlag = parameters.get("hideIgnored") ?? "0";
  if (hideIgnoredFlag !== "0" && hideIgnoredFlag !== "1") {
    return errorResponse("Invalid hideIgnored flag", 400);
  }
  const dir = parameters.get("dir") ?? "";
  const query = (parameters.get("q") ?? "").trim();

  const resolvedDependencies = dependencies ?? defaultDependencies();
  const session = resolvedDependencies.index
    .select({ cwd: schema.sessions.cwd })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
  if (!session) return errorResponse("Session not found", 404);
  if (!session.cwd) return filesResponse({ kind: "no-cwd" });

  const root = await resolveDirectory(session.cwd);
  if (root === null) return filesResponse({ kind: "no-cwd" });
  const allowedRoots = await resolvedDependencies.allowedRoots();
  if (!allowedRoots.some((allowedRoot) => isContainedPath(root, allowedRoot))) {
    return errorResponse("Working directory is not allowed", 403);
  }

  const options = hideIgnoredFlag === "1" ? { ignored: resolvedDependencies.checkIgnored } : {};
  try {
    if (query === "") {
      const listing = await listDir(root, dir, options);
      return filesResponse({ kind: "listing", dir, ...listing });
    }
    const walk = await walkWorkspace(root, dir, options);
    const byPath = new Map(
      walk.entries.map((entry) => [entry.isDirectory ? `${entry.relPath}/` : entry.relPath, entry]),
    );
    const matches = fuzzyFilePaths(query, [...byPath.keys()]);
    return filesResponse({
      kind: "search",
      dir,
      query,
      results: matches.paths.flatMap((path) => byPath.get(path) ?? []),
      partial: walk.partial,
      capped: matches.partial,
    });
  } catch (error) {
    if (error instanceof WorkspacePathError) return errorResponse(error.message, error.status);
    throw error;
  }
}
