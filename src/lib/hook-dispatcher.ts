import { basename } from "node:path";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema";
import type { ActiveSessionEntry } from "./active-session-store";
import {
  DOMAIN_EVENTS,
  SSE_EVENTS,
  type HookEvent,
  type PlanSummaryPayload,
  type MemorySummaryPayload,
  type NotificationPayload,
  type TaskSummaryPayload,
  type SessionPromptSubmittedPayload,
  type SessionToolPendingPayload,
  type SessionCompactingPayload,
} from "./hook-events";
import { buildSessionSummaryPayloadFromDb, toActiveSessionPayload } from "./session-summary";
import { indexFile, indexJsonlFile } from "./db/indexer";
import { resolveProjectName } from "./memory";
import { recentlyBroadcast } from "./update-dedupe";

/**
 * TTL covering the gap between the hook fast-path broadcast and the chokidar
 * trailing broadcast. With `awaitWriteFinish: {stabilityThreshold: 300}` on
 * the watcher (`src/lib/watcher.ts`) the second broadcast lands ~300-400ms
 * later; 500ms is comfortably outside the race but short enough that a
 * second genuine edit isn't suppressed.
 */
const DEDUPE_TTL_MS = 500;

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * Narrow surface of the active-session store the dispatcher needs. Exposed as
 * an interface so tests can substitute a fake without loading the real
 * HMR-persisted singleton.
 */
interface ActiveSessionStore {
  markSessionActive(
    sessionId: string,
    meta: { cwd: string; model?: string; claudeEnv?: Record<string, string> },
  ): void;
  markSessionEnded(sessionId: string): void;
  touchSession(sessionId: string): void;
  getActiveSessionEntry(sessionId: string): ActiveSessionEntry | null;
}

/**
 * Roots of the user's `~/.claude/` tree the dispatcher uses to classify which
 * domain event a `PostToolUse` `Edit | MultiEdit | Write` corresponds to.
 * The route handler at `src/routes/api/hook.ts` is responsible for filling
 * these in from the process environment.
 */
export interface HookDispatchDirs {
  projectsDir: string;
  plansDir: string;
  tasksDir: string;
  commandsDir: string;
  pluginsDir: string;
  statuslineDir: string;
}

/**
 * Persistent per-process state the dispatcher mutates as new lines stream in
 * over hooks. Lives outside the dispatcher so tests can supply a fresh map and
 * the watcher and dispatcher can share the same offsets when wired up via
 * Section 6's dedupe layer.
 */
export interface HookDispatchState {
  jsonlOffsets: Map<string, number>;
}

interface DispatchHookEventArgs {
  event: HookEvent;
  db: IndexDb;
  store: ActiveSessionStore;
  broadcast: (type: string, data: Record<string, unknown>) => void;
  dirs?: HookDispatchDirs;
  state?: HookDispatchState;
}

/** True when `candidate` is the same as `dir` or a descendant. */
function isUnder(candidate: string, dir: string): boolean {
  if (!dir) return false;
  return candidate === dir || candidate.startsWith(dir + "/");
}

/**
 * Resolve the project id (URL-encoded directory name under PROJECTS_DIR) from
 * a transcript path of the form `<projectsDir>/<projectId>/<sessionId>.jsonl`.
 * Returns undefined if `transcriptPath` does not fall under `projectsDir`.
 */
function projectIdFromTranscriptPath(
  transcriptPath: string,
  projectsDir: string,
): string | undefined {
  if (!isUnder(transcriptPath, projectsDir)) return undefined;
  const relative = transcriptPath.slice(projectsDir.length + 1);
  const parts = relative.split("/");
  return parts[0] || undefined;
}

/** Session id derived from a JSONL transcript filename. */
function sessionIdFromTranscriptPath(transcriptPath: string): string {
  return basename(transcriptPath, ".jsonl");
}

/**
 * Extract `tool_input.file_path` from a PostToolUse event for the LLM-edit
 * tools (`Edit`, `MultiEdit`, `Write`). Returns undefined for tools that do
 * not carry a file path. The hook envelope is a `z.union` rather than a
 * discriminated union — TypeScript widens `tool_name` and `tool_input`
 * independently, so we read `file_path` defensively at runtime.
 */
function extractEditedFilePath(event: HookEvent): string | undefined {
  if (event.hook_event_name !== "PostToolUse") return undefined;
  if (
    event.tool_name !== "Edit" &&
    event.tool_name !== "MultiEdit" &&
    event.tool_name !== "Write"
  ) {
    return undefined;
  }
  const toolInput = event.tool_input as { file_path?: unknown };
  return typeof toolInput.file_path === "string" ? toolInput.file_path : undefined;
}

/**
 * Broadcast a `plan:changed` payload for a freshly-indexed plan file. The
 * indexer has already upserted the `plans` row, so the title and mtime are
 * read back from the DB to keep this code path consistent with the watcher
 * path's payload shape.
 */
function broadcastPlanChangedFromDb(
  db: IndexDb,
  filename: string,
  broadcast: (type: string, data: Record<string, unknown>) => void,
): void {
  const row = db.select().from(schema.plans).where(eq(schema.plans.filename, filename)).get();
  if (!row) return;
  const payload: PlanSummaryPayload = {
    filename,
    title: row.title,
    mtime: new Date(row.mtimeMs).toISOString(),
  };
  // Key on the integer mtimeMs (truncated) rather than the ISO string. The
  // watcher path derives mtime via `stat()` which Node may round up to the
  // nearest ms, while the DB stored a truncated copy — using the floored
  // integer here keeps both paths in agreement.
  const key = `${DOMAIN_EVENTS.PLAN_CHANGED}:${filename}:${Math.floor(row.mtimeMs)}`;
  if (recentlyBroadcast(key, DEDUPE_TTL_MS)) return;
  broadcast(DOMAIN_EVENTS.PLAN_CHANGED, { plan: payload });
}

/**
 * Broadcast a `task:changed` payload for a freshly-indexed task file. The
 * row is keyed by file path because task ids are not unique across project
 * dirs. Also emits `task:completed` when the new row's status is `completed`.
 */
function broadcastTaskChangedFromDb(
  db: IndexDb,
  filePath: string,
  broadcast: (type: string, data: Record<string, unknown>) => void,
): void {
  const row = db.select().from(schema.tasks).where(eq(schema.tasks.filePath, filePath)).get();
  if (!row) return;
  const payload: TaskSummaryPayload = {
    taskId: row.taskId,
    projectDir: row.projectDir,
    subject: row.subject,
    description: row.description,
    status: row.status,
    activeForm: row.activeForm,
    blocks: JSON.parse(row.blocksJson) as string[],
    blockedBy: JSON.parse(row.blockedByJson) as string[],
  };
  const taskKey = `${DOMAIN_EVENTS.TASK_CHANGED}:${filePath}:${row.status}`;
  if (recentlyBroadcast(taskKey, DEDUPE_TTL_MS)) return;
  broadcast(DOMAIN_EVENTS.TASK_CHANGED, { task: payload });
  if (row.status === "completed") {
    broadcast(DOMAIN_EVENTS.TASK_COMPLETED, {
      taskId: row.taskId,
      subject: row.subject,
    });
  }
}

/**
 * Broadcast a `memory:changed` payload for a freshly-indexed memory markdown
 * file. The dispatcher reads project metadata back from the DB to mirror the
 * watcher's payload shape exactly.
 */
async function broadcastMemoryChangedFromDb(
  db: IndexDb,
  filePath: string,
  broadcast: (type: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const row = db.select().from(schema.memories).where(eq(schema.memories.filePath, filePath)).get();
  if (!row) return;
  const projectName = await resolveProjectName(row.projectId);
  const payload: MemorySummaryPayload = {
    filename: row.filename,
    title: row.title,
    mtime: new Date(row.mtimeMs).toISOString(),
    project: row.projectId,
    projectName,
  };
  // Key on the integer mtimeMs (truncated) — see `broadcastPlanChangedFromDb`
  // for the precision-mismatch rationale shared with the watcher.
  const key = `${DOMAIN_EVENTS.MEMORY_CHANGED}:${filePath}:${Math.floor(row.mtimeMs)}`;
  if (recentlyBroadcast(key, DEDUPE_TTL_MS)) return;
  broadcast(DOMAIN_EVENTS.MEMORY_CHANGED, { memory: payload });
}

/**
 * Classify a `PostToolUse` file edit and call the appropriate
 * indexer + broadcast pair.
 *
 * Tasks and plan markdown files are mostly edited by the LLM via
 * `Edit | MultiEdit | Write` and surface in `PostToolUse`, so driving the
 * index update directly here cuts ~2s of chokidar debounce latency.
 */
async function handlePostToolUseFileEdit(
  db: IndexDb,
  filePath: string,
  dirs: HookDispatchDirs,
  broadcast: (type: string, data: Record<string, unknown>) => void,
): Promise<void> {
  // Tasks: ~/.claude/tasks/{projectDir}/{taskId}.json
  if (isUnder(filePath, dirs.tasksDir) && filePath.endsWith(".json")) {
    await indexFile(db, filePath, dirs.projectsDir, dirs.plansDir);
    broadcastTaskChangedFromDb(db, filePath, broadcast);
    return;
  }

  // Plans: ~/.claude/plans/{filename}.md
  if (isUnder(filePath, dirs.plansDir) && filePath.endsWith(".md")) {
    await indexFile(db, filePath, dirs.projectsDir, dirs.plansDir);
    broadcastPlanChangedFromDb(db, basename(filePath), broadcast);
    return;
  }

  // Memory markdown files: {projectsDir}/{project}/memory/{filename}.md
  if (isUnder(filePath, dirs.projectsDir) && filePath.endsWith(".md")) {
    await indexFile(db, filePath, dirs.projectsDir, dirs.plansDir);
    await broadcastMemoryChangedFromDb(db, filePath, broadcast);
    return;
  }

  // Commands / Plugins / Statusline directories: the existing wire protocol
  // only has CONTENT_UPDATED for these — fall back to a generic content
  // event so the client refetches.
  if (
    isUnder(filePath, dirs.commandsDir) ||
    isUnder(filePath, dirs.pluginsDir) ||
    isUnder(filePath, dirs.statuslineDir)
  ) {
    broadcast(SSE_EVENTS.CONTENT_UPDATED, {});
  }
}

/**
 * Index a JSONL transcript fragment that grew between the last hook event and
 * this one, then broadcast `session:lines-appended` with the newly-appended
 * lines. The prior offset is read from `state.jsonlOffsets` so multiple hooks
 * for the same session don't re-broadcast the entire transcript.
 */
async function appendTranscriptLines(
  db: IndexDb,
  transcriptPath: string,
  projectsDir: string,
  state: HookDispatchState | undefined,
  broadcast: (type: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const project = projectIdFromTranscriptPath(transcriptPath, projectsDir);
  if (!project) return;

  const sessionId = sessionIdFromTranscriptPath(transcriptPath);
  const fromOffset = state?.jsonlOffsets.get(transcriptPath) ?? 0;
  try {
    const { readNewJsonlLines } = await import("./sessions");
    const { lines: newLines, nextByteOffset } = await readNewJsonlLines(transcriptPath, fromOffset);
    state?.jsonlOffsets.set(transcriptPath, nextByteOffset);
    if (newLines.length > 0) {
      const key = `${DOMAIN_EVENTS.SESSION_LINES_APPENDED}:${sessionId}:${nextByteOffset}`;
      if (!recentlyBroadcast(key, DEDUPE_TTL_MS)) {
        broadcast(DOMAIN_EVENTS.SESSION_LINES_APPENDED, {
          sessionId,
          lines: newLines,
        });
      }
    }
  } catch {
    // transient read error — chokidar will retry
  }

  try {
    await indexJsonlFile(db, transcriptPath, project);
  } catch {
    // transient index error — chokidar will retry
  }
}

/**
 * Route a single parsed hook event to the active-session store and SSE
 * broadcaster. Each case emits enriched domain-level deltas that the client
 * patches directly into the TanStack Query cache. SESSION_START / SESSION_END
 * remain on the wire as lifecycle signals for the active-session indicator;
 * everything else is a DOMAIN_EVENTS delta.
 */
export async function dispatchHookEvent({
  event,
  db,
  store,
  broadcast,
  dirs,
  state,
}: DispatchHookEventArgs): Promise<void> {
  switch (event.hook_event_name) {
    case "SessionStart": {
      const meta: {
        cwd: string;
        model?: string;
        claudeEnv?: Record<string, string>;
      } = {
        cwd: event.cwd ?? "",
      };
      if (event.model !== undefined) {
        meta.model = event.model;
      }
      if (event.claude_env !== undefined) {
        meta.claudeEnv = event.claude_env;
      }
      store.markSessionActive(event.session_id, meta);

      // Lifecycle signal for the active-session indicator.
      broadcast(SSE_EVENTS.SESSION_START, {
        sessionId: event.session_id,
        cwd: event.cwd ?? "",
        model: event.model ?? "",
      });

      // Enriched domain events
      const active = store.getActiveSessionEntry(event.session_id);
      if (active) {
        broadcast(DOMAIN_EVENTS.SESSION_STARTED, {
          session: toActiveSessionPayload(active),
        });
      }
      const summary = buildSessionSummaryPayloadFromDb(db, event.session_id);
      if (summary) {
        const key = `${DOMAIN_EVENTS.SESSION_ADDED}:${summary.id}:${summary.mtime}`;
        if (!recentlyBroadcast(key, DEDUPE_TTL_MS)) {
          broadcast(DOMAIN_EVENTS.SESSION_ADDED, { session: summary });
        }
      }
      break;
    }

    case "SessionEnd": {
      store.markSessionEnded(event.session_id);
      broadcast(SSE_EVENTS.SESSION_END, { sessionId: event.session_id });
      broadcast(DOMAIN_EVENTS.SESSION_ENDED, { sessionId: event.session_id });
      break;
    }

    case "Stop": {
      store.touchSession(event.session_id);
      const summary = buildSessionSummaryPayloadFromDb(db, event.session_id);
      if (summary) {
        const key = `${DOMAIN_EVENTS.SESSION_UPDATED}:${summary.id}:${summary.mtime}`;
        if (!recentlyBroadcast(key, DEDUPE_TTL_MS)) {
          broadcast(DOMAIN_EVENTS.SESSION_UPDATED, { session: summary });
        }
      }
      break;
    }

    case "PostToolUse": {
      store.touchSession(event.session_id);

      // Fast-path: LLM edits to plan / task / memory / commands / plugins /
      // statusline files. The watcher will pick these up ~2s later; the
      // dedupe layer (Section 6) suppresses the trailing duplicate.
      const editedFilePath = extractEditedFilePath(event);
      if (dirs && editedFilePath) {
        try {
          await handlePostToolUseFileEdit(db, editedFilePath, dirs, broadcast);
        } catch {
          // transient indexing error — chokidar will retry
        }
      }

      // Any tool that carries a transcript_path lets us emit
      // SESSION_LINES_APPENDED without waiting for chokidar to re-read
      // the JSONL on a 2s debounce.
      if (dirs && event.transcript_path) {
        await appendTranscriptLines(db, event.transcript_path, dirs.projectsDir, state, broadcast);
      }
      break;
    }

    case "SubagentStop": {
      // Subagents share the same shape as a top-level Stop, but the
      // session_id here is the subagent's id. The subagents indexer already
      // knows the parent linkage, so we just touch the session and emit a
      // SESSION_UPDATED with the enriched payload if it's been indexed.
      store.touchSession(event.session_id);
      const summary = buildSessionSummaryPayloadFromDb(db, event.session_id);
      if (summary) {
        const key = `${DOMAIN_EVENTS.SESSION_UPDATED}:${summary.id}:${summary.mtime}`;
        if (!recentlyBroadcast(key, DEDUPE_TTL_MS)) {
          broadcast(DOMAIN_EVENTS.SESSION_UPDATED, { session: summary });
        }
      }
      break;
    }

    case "UserPromptSubmit": {
      store.touchSession(event.session_id);
      broadcast(DOMAIN_EVENTS.SESSION_PROMPT_SUBMITTED, {
        sessionId: event.session_id,
        prompt: event.prompt,
        ts: new Date().toISOString(),
      } satisfies SessionPromptSubmittedPayload);
      break;
    }

    case "PreToolUse": {
      store.touchSession(event.session_id);
      broadcast(DOMAIN_EVENTS.SESSION_TOOL_PENDING, {
        sessionId: event.session_id,
        toolName: event.tool_name,
        toolUseId: event.tool_use_id ?? "",
      } satisfies SessionToolPendingPayload);
      break;
    }

    case "Notification": {
      store.touchSession(event.session_id);
      broadcast(DOMAIN_EVENTS.NOTIFICATION, {
        sessionId: event.session_id,
        message: event.message,
        title: event.title,
      } satisfies NotificationPayload);
      break;
    }

    case "PreCompact": {
      store.touchSession(event.session_id);
      broadcast(DOMAIN_EVENTS.SESSION_COMPACTING, {
        sessionId: event.session_id,
        trigger: event.trigger,
      } satisfies SessionCompactingPayload);
      break;
    }

    case "TaskCompleted": {
      broadcast(DOMAIN_EVENTS.TASK_COMPLETED, {
        taskId: event.task_id ?? "",
        subject: event.task_subject ?? "",
      });
      store.touchSession(event.session_id);
      break;
    }

    case "WorktreeCreate": {
      broadcast(SSE_EVENTS.WORKTREE_CREATED, {
        sessionId: event.session_id,
        name: event.name ?? "",
      });
      break;
    }
  }
}
