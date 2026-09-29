import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import {
  formatDiffScope,
  parseDiffScope,
  SessionDiffErrorResponseSchema,
  SessionDiffFileResponseSchema,
  SessionDiffResponseSchema,
  SessionDiffScopesResponseSchema,
  type SessionDiffFile,
  type SessionDiffResponse,
  type SessionDiffScope,
} from "./api/session-diff";
import { getDb } from "./db";
import * as schema from "./db/schema";
import { parseJsonlRecord, type JsonlRecord } from "./schemas";
import {
  buildScopeDiff,
  listScopes,
  type DiffFile,
  type DiffScope,
  type DiffScopes,
  type NoGit,
  type ScopeDiff,
  type ScopeDiffOptions,
} from "./session-diff";
import { aggregateSessionEdits } from "./session-edits-diff";

type IndexDb = BetterSQLite3Database<typeof schema>;

/** Patches longer than this are left out of the list response and fetched per file. */
const INLINE_PATCH_LINE_LIMIT = 2000;

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

export interface SessionDiffHandlerDependencies {
  index: IndexDb;
  resolveDirectory(cwd: string): Promise<string | null>;
  listScopes(cwd: string): Promise<DiffScopes | NoGit>;
  buildScopeDiff(
    cwd: string,
    scope: DiffScope,
    options: ScopeDiffOptions,
  ): Promise<ScopeDiff | NoGit>;
  readRecords(filePath: string): Promise<JsonlRecord[]>;
}

function defaultDependencies(): SessionDiffHandlerDependencies {
  return {
    index: getDb().index,
    resolveDirectory,
    listScopes: (cwd) => listScopes(cwd),
    buildScopeDiff: (cwd, scope, options) => buildScopeDiff(cwd, scope, options),
    readRecords,
  };
}

async function resolveDirectory(cwd: string): Promise<string | null> {
  try {
    const resolved = await realpath(cwd);
    return (await stat(resolved)).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

async function readRecords(filePath: string): Promise<JsonlRecord[]> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => parseJsonlRecord(line) ?? []);
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": PRIVATE_NO_CACHE } });
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse(SessionDiffErrorResponseSchema.parse({ error }), status);
}

interface SessionLocation {
  cwd: string;
  filePath: string;
}

function findSession(
  index: IndexDb,
  sessionId: string,
): { location: SessionLocation } | { error: Response } {
  const session = index
    .select({ cwd: schema.sessions.cwd, filePath: schema.sessions.filePath })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
  if (!session) return { error: errorResponse("Session not found", 404) };
  if (!session.cwd) return { error: errorResponse("Session has no working directory", 422) };
  return { location: { cwd: session.cwd, filePath: session.filePath } };
}

function isRealUserPrompt(record: JsonlRecord): boolean {
  if (record.type !== "user" || record.toolUseResult !== undefined) return false;
  if (record.isMeta === true || record.isCompactSummary === true) return false;
  const { content } = record.message;
  if (typeof content === "string") return true;
  return !content.some((block) => block.type === "tool_result");
}

/** The uuids of the prompt-to-prompt turn that contains `uuid`, or null when no record has it. */
function turnUuids(records: readonly JsonlRecord[], uuid: string): Set<string> | null {
  let current = new Set<string>();
  let found = false;
  for (const record of records) {
    if (isRealUserPrompt(record)) {
      if (found) break;
      current = new Set();
    }
    const recordUuid = "uuid" in record ? record.uuid : undefined;
    if (typeof recordUuid === "string") {
      current.add(recordUuid);
      if (recordUuid === uuid) found = true;
    }
  }
  return found ? current : null;
}

function displayPath(path: string, cwd: string): string {
  const relativePath = relative(cwd, path);
  return relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)
    ? path
    : relativePath;
}

function countPatchLines(patch: string): number {
  if (patch === "") return 0;
  return patch.endsWith("\n") ? patch.split("\n").length - 1 : patch.split("\n").length;
}

function toResponseFile(file: DiffFile, inline: boolean): SessionDiffFile {
  const patchLineCount = countPatchLines(file.patch);
  const patch = inline || patchLineCount <= INLINE_PATCH_LINE_LIMIT ? file.patch : null;
  const base = {
    path: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
    patchLineCount,
    patch,
  };
  return file.oldPath === undefined ? base : { ...base, oldPath: file.oldPath };
}

type ResolvedDiff =
  | { kind: "ok"; scope: string; source: SessionDiffResponse["source"]; files: DiffFile[] }
  | { kind: "error"; response: Response };

async function sessionEditsDiff(
  dependencies: SessionDiffHandlerDependencies,
  location: SessionLocation,
  scope: Extract<SessionDiffScope, { kind: "session" | "turn" }>,
): Promise<ResolvedDiff> {
  const records = await dependencies.readRecords(location.filePath);
  let uuids: Set<string> | undefined;
  if (scope.kind === "turn") {
    const found = turnUuids(records, scope.uuid);
    if (found === null) return { kind: "error", response: errorResponse("Turn not found", 404) };
    uuids = found;
  }
  const edits = aggregateSessionEdits(records, uuids === undefined ? {} : { turnUuids: uuids });
  const files = edits.map((file): DiffFile => ({
    path: displayPath(file.path, location.cwd),
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    binary: false,
    patch: file.patch,
  }));
  return { kind: "ok", scope: formatDiffScope(scope), source: "session-edits", files };
}

async function resolveDiff(
  dependencies: SessionDiffHandlerDependencies,
  location: SessionLocation,
  scope: SessionDiffScope,
  hideWhitespace: boolean,
): Promise<ResolvedDiff> {
  if (scope.kind === "session" || scope.kind === "turn") {
    return sessionEditsDiff(dependencies, location, scope);
  }

  const fallback = () => sessionEditsDiff(dependencies, location, { kind: "session" });
  const directory = await dependencies.resolveDirectory(location.cwd);
  if (directory === null) return fallback();

  let diff: ScopeDiff | NoGit;
  try {
    diff = await dependencies.buildScopeDiff(directory, scope, { hideWhitespace });
  } catch (error) {
    if (scope.kind !== "commit") throw error;
    return { kind: "error", response: errorResponse("Commit not found", 404) };
  }
  if (diff.kind === "no-git") return fallback();
  return { kind: "ok", scope: formatDiffScope(scope), source: "git", files: diff.files };
}

/** `GET /api/sessions/$id/diff?scope=…&ws=0|1[&file=<path>]` */
export async function handleSessionDiffRequest(
  sessionId: string,
  parameters: URLSearchParams,
  dependencies?: SessionDiffHandlerDependencies,
): Promise<Response> {
  if (!sessionId) return errorResponse("A session id is required", 400);
  const scope = parseDiffScope(parameters.get("scope") ?? "branch");
  if (scope === null) return errorResponse("Invalid diff scope", 400);
  const ws = parameters.get("ws") ?? "0";
  if (ws !== "0" && ws !== "1") return errorResponse("Invalid ws flag", 400);

  const resolvedDependencies = dependencies ?? defaultDependencies();
  const session = findSession(resolvedDependencies.index, sessionId);
  if ("error" in session) return session.error;

  const diff = await resolveDiff(resolvedDependencies, session.location, scope, ws === "1");
  if (diff.kind === "error") return diff.response;

  const filePath = parameters.get("file");
  if (filePath !== null) {
    const file = diff.files.find((candidate) => candidate.path === filePath);
    if (file === undefined) return errorResponse("File not in diff", 404);
    return jsonResponse(
      SessionDiffFileResponseSchema.parse({ scope: diff.scope, file: toResponseFile(file, true) }),
    );
  }

  const files = diff.files.map((file) => toResponseFile(file, false));
  return jsonResponse(
    SessionDiffResponseSchema.parse({
      scope: diff.scope,
      source: diff.source,
      stats: {
        files: files.length,
        additions: files.reduce((sum, file) => sum + file.additions, 0),
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      },
      files,
    }),
  );
}

/** `GET /api/sessions/$id/diff/scopes` */
export async function handleSessionDiffScopesRequest(
  sessionId: string,
  dependencies?: SessionDiffHandlerDependencies,
): Promise<Response> {
  if (!sessionId) return errorResponse("A session id is required", 400);
  const resolvedDependencies = dependencies ?? defaultDependencies();
  const session = findSession(resolvedDependencies.index, sessionId);
  if ("error" in session) return session.error;

  const directory = await resolvedDependencies.resolveDirectory(session.location.cwd);
  const scopes: DiffScopes | NoGit =
    directory === null ? { kind: "no-git" } : await resolvedDependencies.listScopes(directory);
  return jsonResponse(
    SessionDiffScopesResponseSchema.parse(
      scopes.kind === "no-git" ? scopes : { ...scopes, kind: "git" },
    ),
  );
}
