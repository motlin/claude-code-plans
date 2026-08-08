import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { core, ZodError } from "zod";
import { DOMAIN_EVENTS, HookEventEnvelope } from "../../lib/hook-events";
import { broadcastTyped } from "../../lib/watcher";
import {
  dispatchHookEvent,
  type HookDispatchDirs,
  type HookDispatchState,
} from "../../lib/hook-dispatcher";
import {
  getActiveSessionEntry,
  markSessionActive,
  markSessionEnded,
  setSessionState,
  touchSession,
} from "../../lib/active-session-store";
import { getCacheDir } from "../../lib/db/connection";
import { getDb } from "../../lib/db";
import { hookSchemaDrift } from "../../lib/db/schema";
import { indexFile } from "../../lib/db/indexer";
import { hmrPersist } from "../../lib/hmr-persist";
import { rejectCrossSite } from "../../lib/same-origin-guard";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as dbSchema from "../../lib/db/schema";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const PLANS_DIR = join(homedir(), ".claude", "plans");
const TASKS_DIR = join(homedir(), ".claude", "tasks");
const COMMANDS_DIR = join(homedir(), ".claude", "commands");
const PLUGINS_DIR = join(homedir(), ".claude", "plugins", "cache");
const STATUSLINE_DIR = join(getCacheDir(), "statusline");

const HOOK_DIRS: HookDispatchDirs = {
  projectsDir: PROJECTS_DIR,
  plansDir: PLANS_DIR,
  tasksDir: TASKS_DIR,
  commandsDir: COMMANDS_DIR,
  pluginsDir: PLUGINS_DIR,
  statuslineDir: STATUSLINE_DIR,
};

/**
 * Shared JSONL byte-offset map for the dispatcher's `SESSION_LINES_APPENDED`
 * fast path. Persisted across HMR reloads so the dispatcher does not
 * re-broadcast already-seen lines after a hot reload.
 */
const dispatcherState: HookDispatchState = {
  jsonlOffsets: hmrPersist("hookDispatcherJsonlOffsets", () => new Map<string, number>()),
};

/** Truncated raw body to keep the drift table from growing unbounded. */
const RAW_BODY_MAX_BYTES = 16_384;

/**
 * Compute a stable sha256 of the body so duplicate drifts collapse onto a
 * single row keyed by (hook_event_name, body_sha256). Hash the raw text rather
 * than re-serializing to avoid key churn from object-property ordering.
 */
function hashBody(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Extract missing-field and unknown-field paths from the Zod error issue list.
 * Zod v4 marks missing required fields as `'invalid_type'` with
 * `expected !== 'undefined'` and `received === 'undefined'`; unknown keys come
 * through as `'unrecognized_keys'`.
 */
function walkZodIssues(
  issues: core.$ZodIssue[],
  output: core.$ZodIssue[],
  state: { matchedToolArm: boolean },
): void {
  for (const issue of issues) {
    if (issue.code !== "invalid_union") {
      output.push(issue);
      continue;
    }

    const isToolUnion = issue.errors.some((arm) =>
      arm.some((armIssue) => armIssue.path[0] === "tool_name"),
    );
    for (const arm of issue.errors) {
      const discriminatorFailed = arm.some(
        (armIssue) => armIssue.path[0] === "hook_event_name" || armIssue.path[0] === "tool_name",
      );
      if (discriminatorFailed) continue;
      if (isToolUnion) state.matchedToolArm = true;
      walkZodIssues(arm, output, state);
    }
  }
}

function extractUnmatchedToolName(body: unknown, matchedToolArm: boolean): string | undefined {
  if (matchedToolArm || typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (
    record["hook_event_name"] !== "PreToolUse" &&
    record["hook_event_name"] !== "PostToolUse" &&
    record["hook_event_name"] !== "PostToolUseFailure"
  ) {
    return undefined;
  }
  return typeof record["tool_name"] === "string" ? record["tool_name"] : undefined;
}

export function classifyZodIssues(
  error: ZodError,
  body: unknown,
): {
  missingFields: string[];
  unknownFields: string[];
} {
  const missingFields = new Set<string>();
  const unknownFields = new Set<string>();
  const relevantIssues: core.$ZodIssue[] = [];
  const state = { matchedToolArm: false };
  walkZodIssues(error.issues, relevantIssues, state);

  for (const issue of relevantIssues) {
    const path = issue.path.join(".");
    if (issue.code === "unrecognized_keys") {
      const keys = (issue as { keys?: unknown }).keys;
      if (Array.isArray(keys)) {
        for (const key of keys) {
          if (typeof key === "string") {
            unknownFields.add(path ? `${path}.${key}` : key);
          }
        }
      }
      continue;
    }
    if (issue.code === "invalid_type") {
      const received = (issue as { received?: unknown }).received;
      if (received === "undefined") {
        if (path) missingFields.add(path);
      }
    }
  }
  const unmatchedToolName = extractUnmatchedToolName(body, state.matchedToolArm);
  if (unmatchedToolName) unknownFields.add(`tool_name: ${unmatchedToolName}`);
  return {
    missingFields: [...missingFields].sort(),
    unknownFields: [...unknownFields].sort(),
  };
}

/**
 * Read `tool_input.file_path` from a payload that already failed schema
 * validation. We can't trust the type, so we walk the structure defensively
 * and return undefined for anything that isn't a plain string.
 */
function extractFilePath(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const toolInput = (body as Record<string, unknown>)["tool_input"];
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const filePath = (toolInput as Record<string, unknown>)["file_path"];
  return typeof filePath === "string" ? filePath : undefined;
}

function extractHookEventName(body: unknown): string {
  if (typeof body !== "object" || body === null) return "unknown";
  const name = (body as Record<string, unknown>)["hook_event_name"];
  return typeof name === "string" ? name : "unknown";
}

/**
 * Persist a schema-drift row keyed by (hook_event_name, body_sha256). Repeat
 * drifts increment the `count` column and refresh `last_seen_at` instead of
 * inserting a new row so a misbehaving hook can't flood the table.
 *
 * Returns the post-upsert `count` so callers can include it in the broadcast.
 */
function persistDrift(
  db: BetterSQLite3Database<typeof dbSchema>,
  hookEventName: string,
  bodySha256: string,
  rawBody: string,
  issuesJson: string,
): number {
  const now = Date.now();
  const truncated =
    rawBody.length > RAW_BODY_MAX_BYTES ? rawBody.slice(0, RAW_BODY_MAX_BYTES) : rawBody;

  const result = db
    .insert(hookSchemaDrift)
    .values({
      hookEventName,
      bodySha256,
      rawBody: truncated,
      issuesJson,
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [hookSchemaDrift.hookEventName, hookSchemaDrift.bodySha256],
      set: { count: sql`${hookSchemaDrift.count} + 1`, lastSeenAt: now },
    })
    .returning({ count: hookSchemaDrift.count })
    .get();
  return result?.count ?? 1;
}

export const Route = createFileRoute("/api/hook")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const rawText = await request.text();
        let body: unknown;
        try {
          body = JSON.parse(rawText) as unknown;
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const result = HookEventEnvelope.safeParse(body);

        if (!result.success) {
          const { index } = getDb();
          const hookEventName = extractHookEventName(body);
          const bodySha256 = hashBody(rawText);
          const { missingFields, unknownFields } = classifyZodIssues(result.error, body);
          const issuesJson = JSON.stringify(result.error.issues);

          let count = 1;
          try {
            count = persistDrift(index, hookEventName, bodySha256, rawText, issuesJson);
          } catch {
            // transient DB error — still broadcast and attempt fallback
          }

          broadcastTyped(DOMAIN_EVENTS.HOOK_SCHEMA_DRIFT, {
            hookEventName,
            missingFields,
            unknownFields,
            count,
          });

          // Watcher-style fallback: if this looks like a PostToolUse on a file
          // we'd otherwise pick up via chokidar, index it directly so the
          // client still sees the update. Anything else is left for chokidar.
          if (hookEventName === "PostToolUse") {
            const filePath = extractFilePath(body);
            if (filePath) {
              try {
                await indexFile(index, filePath, PROJECTS_DIR, PLANS_DIR);
              } catch {
                // fall through — chokidar will retry
              }
            }
          }

          // Return 202 so Claude Code's hook curl exits 0 and doesn't surface
          // a hook failure to the user. The drift is persisted server-side.
          return Response.json({ ok: false, drift: true, count }, { status: 202 });
        }

        const { index } = getDb();

        await dispatchHookEvent({
          event: result.data,
          db: index,
          store: {
            markSessionActive,
            markSessionEnded,
            setSessionState,
            touchSession,
            getActiveSessionEntry,
          },
          broadcast: broadcastTyped,
          dirs: HOOK_DIRS,
          state: dispatcherState,
        });

        return Response.json({ ok: true });
      },
    },
  },
});
